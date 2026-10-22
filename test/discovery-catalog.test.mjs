import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryCatalog} from '../src/discovery-catalog.mjs';

test('title search exposes movie and TV choices without upstream private data or people',async()=>{
  const catalog=createDiscoveryCatalog({request:async path=>{
    assert.equal(path,'/api/v1/search?query=Example%20%26%20Friends&page=1&language=en');
    return {results:[{id:101,mediaType:'movie',title:'Example',releaseDate:'2024-10-01',overview:'A story',privateKey:'hidden'},
      {id:202,mediaType:'tv',name:'Friends',firstAirDate:'2020-01-01'},{id:303,mediaType:'person',name:'A person'}]};
  }});
  assert.deepEqual(await catalog.search('Example & Friends'),[
    {id:101,type:'movie',title:'Example',year:2024,overview:'A story'},
    {id:202,type:'tv',title:'Friends',year:2020,overview:''},
  ]);
});

test('choosing a TV season resolves IDs and includes only dated aired episodes',async()=>{
  const catalog=createDiscoveryCatalog({now:()=>new Date('2026-10-21T12:00:00Z'),request:async path=>{
    if(path==='/api/v1/tv/202')return {id:202,name:'Example Show',externalIds:{imdbId:'tt1234567',tvdbId:1234},seasons:[{seasonNumber:1,name:'Season 1',episodeCount:3}]};
    if(path==='/api/v1/tv/202/season/1')return {episodes:[
      {episodeNumber:1,seasonNumber:1,airDate:'2026-10-20'},
      {episodeNumber:2,seasonNumber:1,airDate:'2026-10-23'},
      {episodeNumber:3,seasonNumber:1,airDate:null},
    ]};
    throw Error('Unexpected route');
  }});
  const title=await catalog.describe({type:'tv',id:202});
  assert.deepEqual(title.seasons,[{number:1,name:'Season 1',episodes:3}]);
  assert.equal(title.tvdbId,1234);
  assert.deepEqual(await catalog.items({type:'tv',id:202,season:1}),[
    {type:'series',imdbId:'tt1234567',title:'Example Show',season:1,episode:1},
  ]);
  await assert.rejects(catalog.items({type:'tv',id:202,season:2}),/season/);
});

test('unmatched titles and undated seasons cannot create speculative streaming links',async()=>{
  const missing=createDiscoveryCatalog({request:async()=>({id:101,title:'Unmatched'})});
  await assert.rejects(missing.items({type:'movie',id:101}),/IMDb/);
  const malformed=createDiscoveryCatalog({now:()=>new Date('2026-10-21T00:00:00Z'),request:async path=>path.endsWith('/season/1')?
    {episodes:[{episodeNumber:1,seasonNumber:1,airDate:'2020-99-01'}]}:
    {id:202,name:'Show',externalIds:{imdbId:'tt1234567'},seasons:[{seasonNumber:1,episodeCount:1}]}});
  await assert.rejects(malformed.items({type:'tv',id:202,season:1}),/aired/);
});
