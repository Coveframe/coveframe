"""Finite, GUI-subsystem lab installer. Never alters the production service."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys

PROJECT = Path(__file__).resolve().parent.parent
ROOT = Path(r"C:\ProgramData\MediaHubLab")
SERVICE = "MediaHubLabJellyfin"
SERVER = Path(r"C:\Program Files\Jellyfin\Server")
RECEIPT = PROJECT / "artifacts" / "lab-install.json"


def call(argv, timeout=40):
    return subprocess.run([str(value) for value in argv], capture_output=True, text=True,
                          timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW, check=True)


def run():
    global RECEIPT
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action not in ("install", "remove", "arm-boot", "repair-boot", "refresh-boot", "disarm"):
        raise RuntimeError("Expected install, remove, arm-boot or disarm")
    if action in ("arm-boot", "repair-boot", "refresh-boot", "disarm"):
        RECEIPT = PROJECT / "artifacts" / f"lab-{action}.json"
    if not ctypes.windll.shell32.IsUserAnAdmin():
        # ShellExecute requests normal UAC; pythonw prevents a console window.
        parameters = subprocess.list2cmdline([str(Path(__file__).resolve()), action, "--elevated"])
        shell = ctypes.WinDLL("shell32", use_last_error=True)
        shell.ShellExecuteW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                      wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int]
        shell.ShellExecuteW.restype = ctypes.c_void_p
        result = shell.ShellExecuteW(None, "runas", sys.executable, parameters, str(PROJECT), 0) or 0
        if result <= 32:
            error = RuntimeError("Elevation was not completed")
            error.win32_code = result
            error.win32_last_error = ctypes.get_last_error()
            raise error
        return
    if action in ("arm-boot", "repair-boot"):
        command=["powershell.exe", "-NoProfile", "-NonInteractive", "-File", PROJECT / "scripts" / "Arm-BootLab.ps1", "-SourceProject", PROJECT]
        if action == "repair-boot":
            command.append("-ResumeStaging")
        call(command, timeout=240)
        RECEIPT.write_text(json.dumps({"schemaVersion": 1, "status": "armed", "rebootRequested": False}), encoding="utf-8")
        return
    wrapper = SERVER / "nssm.exe"
    if action == "refresh-boot":
        call(["powershell.exe", "-NoProfile", "-NonInteractive", "-File", PROJECT / "scripts" / "Inspect-BootLab.ps1", "-RefreshRunner"])
        RECEIPT.write_text(json.dumps({"schemaVersion": 1, "status": "audited", "rebootRequested": False}), encoding="utf-8")
        return
    if action == "disarm":
        call(["powershell.exe", "-NoProfile", "-NonInteractive", "-File", PROJECT / "scripts" / "Disarm-BootLab.ps1"])
        RECEIPT.write_text(json.dumps({"schemaVersion": 1, "status": "disarmed", "dataPreserved": True}), encoding="utf-8")
        return
    if action == "remove":
        # Remove only our exact service after checking its application and data root.
        application = call([wrapper, "get", SERVICE, "Application"]).stdout.strip().strip('"')
        parameters = call([wrapper, "get", SERVICE, "AppParameters"]).stdout
        if application.lower() != str(SERVER / "jellyfin.exe").lower() or str(ROOT) not in parameters:
            raise RuntimeError("Lab service identity mismatch")
        call([wrapper, "stop", SERVICE])
        call([wrapper, "remove", SERVICE, "confirm"])
        receipt = {"schemaVersion": 1, "status": "removed", "serviceName": SERVICE, "dataPreserved": True}
    else:
        inventory = json.loads(call(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "[pscustomobject]@{services=@(Get-CimInstance Win32_Service | Select-Object -ExpandProperty Name);"
            "ports=@(Get-NetTCPConnection -State Listen | Select-Object -ExpandProperty LocalPort);"
            "rootExists=(Test-Path -LiteralPath 'C:\\ProgramData\\MediaHubLab')} | ConvertTo-Json -Compress"]).stdout)
        # Use the same tested planner as the CLI. No shell command interpolation.
        node = PROJECT / "artifacts" / "node-path.txt"
        plan = json.loads(call([node.read_text(encoding="utf-8-sig").strip(), "--input-type=module", "-e",
            "import {buildLabPlan} from './src/lab-plan.mjs';"
            "process.stdout.write(JSON.stringify(buildLabPlan(JSON.parse(process.argv[1]))));", json.dumps(inventory)]).stdout)
        if plan["serviceName"] != SERVICE or plan["root"] != str(ROOT):
            raise RuntimeError("Unexpected lab plan")
        ROOT.mkdir(exist_ok=False)
        identity = call(["whoami.exe", "/user", "/fo", "csv", "/nh"]).stdout
        import csv
        sid = next(csv.reader([identity.strip()]))[1]
        call(["icacls.exe", ROOT, "/inheritance:r", "/grant:r",
              "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-20:(OI)(CI)M", f"*{sid}:(OI)(CI)M"])
        for directory in plan["directories"]:
            Path(directory).mkdir()
        (ROOT / "config" / "network.xml").write_text(plan["networkXml"], encoding="utf-8")
        call([wrapper, "install", SERVICE, plan["executable"], plan["arguments"]])
        for key, value in (("DisplayName", plan["displayName"]), ("Description", plan["purpose"]),
                           ("ObjectName", plan["identity"]), ("Start", plan["startMode"]),
                           ("AppDirectory", str(SERVER)), ("AppNoConsole", "1"),
                           ("AppStdout", str(ROOT / "logs" / "service-out.log")),
                           ("AppStderr", str(ROOT / "logs" / "service-error.log"))):
            call([wrapper, "set", SERVICE, key, value])
        call([wrapper, "start", SERVICE])
        receipt = {"schemaVersion": 1, "status": "installed", "serviceName": SERVICE,
                   "root": str(ROOT), "url": f"http://127.0.0.1:{plan['port']}", "startMode": "Manual"}
    RECEIPT.parent.mkdir(exist_ok=True)
    RECEIPT.write_text(json.dumps(receipt, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        os.chdir(PROJECT)
        run()
    except Exception as error:
        RECEIPT.parent.mkdir(exist_ok=True)
        RECEIPT.write_text(json.dumps({"status": "error", "type": type(error).__name__,
                                      "code": getattr(error, "returncode", None),
                                      "win32Code": getattr(error, "win32_code", None),
                                      "win32LastError": getattr(error, "win32_last_error", None)}), encoding="utf-8")
        sys.exit(1)
