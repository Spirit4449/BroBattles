const { MapPlaytestService } = require('../../services/maps/mapPlaytestService');
const assets = require('../../services/maps/mapAssetFiles');
const { API_PATHS, mapDocumentPath, mapPlaytestPath } = require("../../../shared/net/apiPaths.js");
const path = require('node:path');
const { isSameOrigin } = require('../../middleware/sameOrigin');
const { mapRepository } = require('../../services/maps/mapRepository');
function registerMapEditorRoutes({app, requireCurrentUser, isAdminUser, pageRoot, mapPlaytests = new MapPlaytestService()}) {
  const admin = handler => async (req,res) => {
    try {
      const user = await requireCurrentUser(req,res);
      if (!user || !isAdminUser(user)) return res.status(403).json({error:'Admin access required'});
      if (req.method !== 'GET' && (req.get('origin') || req.get('sec-fetch-site')) && !isSameOrigin(req)) {
        return res.status(403).json({error:'Same-origin request required'});
      }
      return await handler(req,res,user);
    } catch(e) { return res.status(e.status || 500).json({error:e.status ? e.message : 'Unable to read or save map', errors:e.errors}); }
  };
  app.post(API_PATHS.API_ADMIN_MAPS_UPLOAD, admin((req,res)=>res.json(assets.stageUpload(req.body))));
  app.get('/assets/map-editor-staged/:file', admin((req,res)=>res.sendFile(assets.resolveAssetFile('/assets/map-editor-staged/'+req.params.file))));
  app.get('/assets/map-revisions/:file', (req,res)=>{try{return res.sendFile(assets.resolveAssetFile('/assets/map-revisions/'+req.params.file));}catch{return res.sendStatus(404);}});
  app.get('/map-editor/playtest', admin((req,res)=>res.sendFile(path.join(pageRoot,'game.html'))));
  app.post(API_PATHS.API_ADMIN_MAP_PLAYTESTS, admin((req,res,user)=>res.json(mapPlaytests.create(user,req.body))));
  app.get(mapPlaytestPath(':session'), admin((req,res,user)=>res.json({success:true,gameData:mapPlaytests.get(req.params.session,user).gameData})));
  app.delete(mapPlaytestPath(':session'), admin((req,res,user)=>{mapPlaytests.get(req.params.session,user);mapPlaytests.remove(req.params.session);return res.json({success:true});}));
  app.get('/map-editor', admin((req,res) => res.sendFile(path.join(pageRoot,'map-editor.html'))));
  app.get(API_PATHS.API_ADMIN_MAPS, admin((req,res) => res.json({maps:mapRepository.list().map(({document,revision})=>({id:document.id,label:document.label,modeVariantId:document.modeVariantId,revision}))})));
  app.get(mapDocumentPath(':id'), admin((req,res) => res.json(mapRepository.get(req.params.id))));
  app.put(mapDocumentPath(':id'), admin((req,res) => {
    if (Number(req.params.id) !== req.body?.document?.id) return res.status(400).json({error:'URL and document map IDs must match'});
    return res.json(mapRepository.save(req.body.document, req.body.revision));
  }));
}
module.exports = {registerMapEditorRoutes};
