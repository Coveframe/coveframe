import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const xml = value => String(value).replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[x]);
export function validateLibraryItem(info) {
  if (!info || !['movie','series'].includes(info.type) || !/^tt\d{5,12}$/.test(info.imdbId) || typeof info.title !== 'string' || !info.title.trim() || info.title.length > 200 || /[\x00-\x1f\x7f]/.test(info.title) ||
    info.year !== undefined && (!Number.isInteger(info.year) || info.year < 1870 || info.year > 2200) || info.type === 'series' && (!Number.isInteger(info.season) || info.season < 0 || info.season > 9999 || !Number.isInteger(info.episode) || info.episode < 1 || info.episode > 99999)) throw Error('Enter a valid title, IMDb ID and episode numbers.');
}
export async function writeLibraryItem({ libraryRoot, info, link }) {
  validateLibraryItem(info);
  if (typeof link !== 'string' || !link.startsWith('http://127.0.0.1:18801/') || /[\r\n]/.test(link)) throw Error('A private local playback link is required.');
  const movie = info.type === 'movie';
  let folder = join(libraryRoot, movie ? 'Movies' : 'TV', `Media Hub ${info.imdbId}`);
  await mkdir(folder,{recursive:true});
  const writeOwned = async (path, text) => {
    try { await writeFile(path,text,{flag:'wx'}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (await readFile(path,'utf8') !== text) throw Error('Preserve the existing library entry before changing it.'); }
  };
  const title = xml(info.title.trim());
  if (!movie) {
    await writeOwned(join(folder,'tvshow.nfo'), `<tvshow><title>${title}</title><uniqueid type="imdb" default="true">${info.imdbId}</uniqueid></tvshow>\n`);
    folder = join(folder,`Season ${String(info.season).padStart(2,'0')}`);
    await mkdir(folder,{recursive:true});
  }
  const stem = movie ? 'movie' : `S${String(info.season).padStart(2,'0')}E${String(info.episode).padStart(2,'0')}`;
  await writeOwned(join(folder,stem+'.strm'),link+'\n');
  await writeOwned(join(folder,stem+'.nfo'), movie
    ? `<movie><title>${title}</title>${info.year ? `<year>${info.year}</year>` : ''}<uniqueid type="imdb" default="true">${info.imdbId}</uniqueid></movie>\n`
    : `<episodedetails><title>${title} ${stem}</title><season>${info.season}</season><episode>${info.episode}</episode></episodedetails>\n`);
  return { added: true, type: info.type, imdbId: info.imdbId, title: info.title.trim(), playbackVerified: false };
}
