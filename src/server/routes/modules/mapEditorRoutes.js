const path = require('node:path');
const { mapRepository } = require('../../services/mapRepository');
function registerMapEditorRoutes({app, requireCurrentUser, isAdminUser, pageRoot}) {
  const admin = handler => async (req,res) => {
    try {
      const user = await requireCurrentUser(req,res);
      if (!user || !isAdminUser(user)) return res.status(403).json({error:'Admin access required'});
      if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({error:'Same-origin request required'});
      return await handler(req,res,user);
    } catch(e) { return res.status(e.status || 500).json({error:e.status ? e.message : 'Unable to read or save map', errors:e.errors}); }
  };
  const assets = require('../../services/mapAssetFiles');
  app.post('/api/admin/maps/upload', admin((req,res)=>res.json(assets.stageUpload(req.body))));
  app.get('/assets/map-editor-staged/:file', admin((req,res)=>res.sendFile(assets.resolveAssetFile('/assets/map-editor-staged/'+req.params.file))));
  app.get('/assets/map-revisions/:file', (req,res)=>{try{return res.sendFile(assets.resolveAssetFile('/assets/map-revisions/'+req.params.file));}catch{return res.sendStatus(404);}});
  const { mapPlaytests } = require('../../services/mapPlaytestService');
  app.get('/map-editor/playtest', admin((req,res)=>res.sendFile(path.join(pageRoot,'game.html'))));
  app.post('/api/admin/map-playtests', admin((req,res,user)=>res.json(mapPlaytests.create(user,req.body))));
  app.get('/api/admin/map-playtests/:session', admin((req,res,user)=>res.json({success:true,gameData:mapPlaytests.get(req.params.session,user).gameData})));
  app.delete('/api/admin/map-playtests/:session', admin((req,res,user)=>{mapPlaytests.get(req.params.session,user);mapPlaytests.remove(req.params.session);return res.json({success:true});}));
  app.get('/map-editor', admin((req,res) => res.sendFile(path.join(pageRoot,'map-editor.html'))));
  app.get('/api/admin/maps', admin((req,res) => res.json({maps:mapRepository.list().map(({document,revision})=>({id:document.id,label:document.label,revision}))})));
  app.get('/api/admin/maps/:id', admin((req,res) => res.json(mapRepository.get(req.params.id))));
  app.put('/api/admin/maps/:id', admin((req,res) => {
    if (Number(req.params.id) !== req.body?.document?.id) return res.status(400).json({error:'URL and document map IDs must match'});
    return res.json(mapRepository.save(req.body.document, req.body.revision));
  }));
}
module.exports = {registerMapEditorRoutes};
