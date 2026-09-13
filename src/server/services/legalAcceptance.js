const config = require('../../shared/siteConfig.json');
async function hasLegalAcceptance(db, userId) {
  const rows = await db.runQuery('SELECT 1 FROM legal_acceptances WHERE user_id=? AND terms_version=? AND privacy_version=? LIMIT 1',[userId,config.termsVersion,config.privacyVersion]);
  return rows.length > 0;
}
module.exports={hasLegalAcceptance};
