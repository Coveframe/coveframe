const text=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max):'';
const year=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?Number(value.slice(0,4)):undefined;
const dated=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function validateSelection({type,id}={}) {
  if(!['movie','tv'].includes(type)||!Number.isSafeInteger(id)||id<1)throw Error('Choose a movie or TV show from search.');
}
export function createDiscoveryCatalog({request,now=()=>new Date()}) {
  async function describe(selection){
    validateSelection(selection);
    const {type,id}=selection,data=await request(`/api/v1/${type}/${id}`);
    if(data.id!==id)throw Error('Discovery returned a different title. Search again.');
    const releaseYear=year(data.releaseDate||data.firstAirDate);
    return {type,id,title:text(data.title||data.name,200),...(releaseYear?{year:releaseYear}:{}),
      imdbId:/^tt\d{5,12}$/.test(data.imdbId||data.externalIds?.imdbId||'')?data.imdbId||data.externalIds.imdbId:null,
      tvdbId:Number.isSafeInteger(data.externalIds?.tvdbId)?data.externalIds.tvdbId:null,
      seasons:type==='tv'?(data.seasons||[]).filter(x=>Number.isInteger(x.seasonNumber)&&x.seasonNumber>0&&x.seasonNumber<=9999).slice(0,200).map(x=>({number:x.seasonNumber,name:text(x.name,100),episodes:x.episodeCount})):[],
    };
  }
  return {
    describe,
    async items(selection){
      const detail=await describe(selection);
      if(!detail.imdbId)throw Error('This title has no IMDb match for streaming. Try another title or use downloads.');
      const common={type:detail.type==='tv'?'series':'movie',imdbId:detail.imdbId,title:detail.title,...(detail.year?{year:detail.year}:{})};
      if(detail.type==='movie')return [common];
      if(!detail.seasons.some(x=>x.number===selection.season))throw Error('Choose a season from this show.');
      const season=await request(`/api/v1/tv/${detail.id}/season/${selection.season}`),today=now().toISOString().slice(0,10);
      const episodes=(season.episodes||[]).filter(x=>x.seasonNumber===selection.season&&Number.isInteger(x.episodeNumber)&&x.episodeNumber>0&&x.episodeNumber<=99999&&dated(x.airDate)&&x.airDate<=today);
      if(!episodes.length)throw Error('This season has no dated aired episodes yet.');
      if(episodes.length>100)throw Error('This season is too large to add at once. Use the advanced episode form.');
      return [...new Map(episodes.map(x=>[x.episodeNumber,{...common,season:selection.season,episode:x.episodeNumber}])).values()];
    },
    async search(query){
      if(typeof query!=='string'||query.trim().length<2||query.length>120||/[\x00-\x1f\x7f]/.test(query))throw Error('Enter a title between 2 and 120 characters.');
      const data=await request(`/api/v1/search?query=${encodeURIComponent(query.trim())}&page=1&language=en`);
      return (data.results||[]).filter(x=>['movie','tv'].includes(x.mediaType)&&Number.isSafeInteger(x.id)&&x.id>0).slice(0,20).map(x=>({
        id:x.id,type:x.mediaType,title:text(x.title||x.name,200),year:year(x.releaseDate||x.firstAirDate),overview:text(x.overview,500),
      }));
    },
  };
}
