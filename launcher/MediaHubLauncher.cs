using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

// GUI subsystem avoids a console flash. The media stack is not installed or changed.
internal static class MediaHubLauncher {
    private const string Address = "http://127.0.0.1:18797";
    [STAThread]
    private static int Main(string[] args) {
        bool checkOnly = Array.IndexOf(args, "--check") >= 0;
        try {
            string root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\', '/');
            string identity;
            using (SHA256 hash = SHA256.Create()) {
                identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "").ToLowerInvariant();
            }
            using (Mutex gate = new Mutex(false, "Local\\MediaHubSetupLauncher-" + identity)) {
                if (!gate.WaitOne(35000)) throw new Exception("Another Media Hub launch is still finishing. Try again in a moment.");
                try {
                    int state = Probe(identity);
                    if (state == 2) throw new Exception("Port 18797 belongs to another app or another copy of Media Hub. Stop that app first. Nothing was changed.");
                    if (state == 0) {
                        string node = Path.Combine(root, "runtime", "node.exe");
                        if (!File.Exists(node)) node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                        if (!File.Exists(node)) throw new Exception("The bundled runtime is missing. Extract the complete Coveframe ZIP, then open Coveframe.exe again.");
                        string entry = Path.Combine(root, "bin", "start-local.mjs");
                        if (!File.Exists(entry)) throw new Exception("Extract the complete Media Hub ZIP before opening the launcher.");
                        ProcessStartInfo start = new ProcessStartInfo(node, "\"" + entry + "\"");
                        start.WorkingDirectory = root;
                        start.UseShellExecute = false;
                        start.CreateNoWindow = true;
                        start.WindowStyle = ProcessWindowStyle.Hidden;
                        start.RedirectStandardOutput = true;
                        start.RedirectStandardError = true;
                        using (Process process = new Process()) {
                            process.StartInfo = start;
                            // Never write provider credentials or process output to launcher logs.
                            process.OutputDataReceived += delegate { };
                            process.ErrorDataReceived += delegate { };
                            process.Start();
                            process.BeginOutputReadLine();
                            process.BeginErrorReadLine();
                            for (int i = 0; i < 100; i++) {
                                Thread.Sleep(250);
                                state = Probe(identity);
                                if (state == 1) break;
                                if (state == 2 || process.HasExited) throw new Exception("Media Hub could not start. The port may be busy or saved setup may be inaccessible. No existing media services were changed.");
                            }
                            if (state != 1) throw new Exception("Media Hub took too long to start. Try opening it again. No existing processes were stopped.");
                        }
                    }
                    if (!checkOnly) Process.Start(new ProcessStartInfo(Address) { UseShellExecute = true });
                    return 0;
                } finally { gate.ReleaseMutex(); }
            }
        } catch (Exception error) {
            if (checkOnly) Console.Error.WriteLine(error.Message);
            if (!checkOnly) MessageBox.Show(error.Message, "Media Hub setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }
    // Probe never adopts or stops an unrelated listener. Identity ties it to this folder.
    private static int Probe(string identity) {
        try {
            bool listening = false;
            foreach (IPEndPoint endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()) {
                if (endpoint.Port == 18797) { listening = true; break; }
            }
            if (!listening) return 0;
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Address + "/health");
            request.Proxy = null;
            request.Timeout = 800;
            request.ReadWriteTimeout = 800;
            request.AllowAutoRedirect = false;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) {
                if (response.StatusCode != HttpStatusCode.OK || response.ContentLength > 8192) return 2;
                using (StreamReader reader = new StreamReader(response.GetResponseStream())) {
                    char[] buffer = new char[8193];
                    int size = reader.ReadBlock(buffer, 0, buffer.Length);
                    if (size > 8192) return 2;
                    var json = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new string(buffer, 0, size));
                    return json.ContainsKey("app") && (string)json["app"] == "media-hub-local-setup" && json.ContainsKey("instanceId") && (string)json["instanceId"] == identity ? 1 : 2;
                }
            }
        } catch (WebException error) {
            return error.Status == WebExceptionStatus.ConnectFailure ? 0 : 2;
        } catch { return 2; }
    }
}
