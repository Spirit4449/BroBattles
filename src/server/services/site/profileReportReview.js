const REASONS = require('../../../shared/social/profileReports.json');

const REVIEW_POLICY = Object.freeze({ windowDays: 30, memberReportersForReview: 3 });

// Reports already store this server-generated subject, including a stable account
// ID. The category is reserved by createReport; ordinary support cannot set it.
function reportTargetId(request) {
  if (request.kind !== 'support' || request.category !== 'reports') return null;
  const match = /^Report: .+ \(#([1-9]\d*)\)$/.exec(request.subject || '');
  const id = Number(match?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function reportRecommendation(summary) {
  const { windowDays, memberReportersForReview } = REVIEW_POLICY;
  if (summary.recentMemberReporters >= memberReportersForReview) {
    return {
      code: 'consider_penalty',
      title: 'Consider a penalty',
      explanation: `${summary.recentMemberReporters} registered reporters in ${windowDays} days. Confirm the evidence before acting.`,
    };
  }
  if (summary.recentReports >= memberReportersForReview) {
    return {
      code: 'investigate',
      title: 'Investigate reports',
      explanation: `${summary.recentReports} recent reports, ${summary.recentMemberReporters} registered reporters. Check for repeat or guest reports.`,
    };
  }
  return {
    code: 'hold',
    title: 'No penalty suggested',
    explanation: 'Limited recent report history. Review any evidence before deciding.',
  };
}

async function loadReportCounts(q, targetIds) {
  const ids = [...new Set(targetIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const recent = `r.created_at >= DATE_SUB(NOW(3), INTERVAL ${REVIEW_POLICY.windowDays} DAY)`;
  const rows = await q(`SELECT
      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(r.subject, '(#', -1), ')', 1) AS UNSIGNED) AS targetUserId,
      COUNT(*) AS totalReports, COUNT(DISTINCT r.user_id) AS uniqueReporters,
      SUM(${recent}) AS recentReports,
      COUNT(DISTINCT CASE WHEN ${recent} THEN r.user_id END) AS recentReporters,
      COUNT(DISTINCT CASE WHEN ${recent} AND u.user_id IS NOT NULL AND u.expires_at IS NULL THEN r.user_id END) AS recentMemberReporters,
      SUM(r.status <> 'closed') AS activeReports
    FROM site_requests r LEFT JOIN users u ON u.user_id=r.user_id
    WHERE r.kind='support' AND r.category='reports' AND (${ids.map(() => 'r.subject LIKE ?').join(' OR ')})
    GROUP BY targetUserId`, ids.map(id => `% (#${id})`));
  return new Map(rows.map(row => {
    const summary = Object.fromEntries(['totalReports', 'uniqueReporters', 'recentReports', 'recentReporters', 'recentMemberReporters', 'activeReports']
      .map(key => [key, Number(row[key]) || 0]));
    return [Number(row.targetUserId), { targetUserId: Number(row.targetUserId), ...summary }];
  }));
}

function savedReason(body) {
  const label = /^Reported player: [^\n]+\nAccount ID: \d+\nReason: ([^\n]+)\n\n/.exec(body || '')?.[1];
  return REASONS.find(reason => reason.label === label)?.label || 'Unspecified';
}

async function loadReportReview(q, request) {
  const targetUserId = reportTargetId(request);
  if (!targetUserId) return null;
  const counts = await loadReportCounts(q, [targetUserId]);
  const summary = counts.get(targetUserId);
  if (!summary) return null;
  const [target] = await q('SELECT user_id, name, selected_profile_icon_id, char_class FROM users WHERE user_id=?', [targetUserId]);
  const history = await q(`SELECT r.id, r.subject, r.status, r.created_at, r.user_id AS reporterId, u.name AS reporterName,
      (SELECT m.body FROM site_request_messages m WHERE m.request_id=r.id AND m.sender='player' ORDER BY m.id LIMIT 1) AS firstMessage
    FROM site_requests r LEFT JOIN users u ON u.user_id=r.user_id
    WHERE r.kind='support' AND r.category='reports' AND r.subject LIKE ?
    ORDER BY r.created_at DESC, r.id DESC LIMIT 10`, [`% (#${targetUserId})`]);
  return {
    ...summary,
    windowDays: REVIEW_POLICY.windowDays,
    reviewThreshold: REVIEW_POLICY.memberReportersForReview,
    targetName: target?.name || request.subject.replace(/^Report: /, '').replace(/ \(#\d+\)$/, ''),
    targetIcon: target?.selected_profile_icon_id || target?.char_class || null,
    targetExists: !!target,
    recommendation: reportRecommendation(summary),
    history: history.map(({ firstMessage, ...item }) => ({ ...item, reason: savedReason(firstMessage) })),
  };
}

module.exports = { REVIEW_POLICY, reportTargetId, reportRecommendation, loadReportCounts, loadReportReview };
