// Ticket rules used by the API, player support form and admin inbox.
const { deepFreeze } = require('../deepFreeze');

// Declaration order is the admin filter order. formOrder controls which topics
// players may pick and the order in which the contact form shows them.
const topics = deepFreeze({
  bug: { label: "Bug or crash", formOrder: 3 },
  idea: { label: "Idea" },
  gameplay: { label: "Gameplay", formOrder: 4 },
  account: { label: "Account", formOrder: 1 },
  purchase: { label: "Purchase", formOrder: 2 },
  safety: { label: "Player safety", formOrder: 5 },
  privacy: { label: "Privacy", formOrder: 6 },
  other: { label: "Something else", formOrder: 7 },
});
const CATEGORIES = Object.freeze(Object.keys(topics));
const REPORT_CATEGORY = "reports";
const INBOX_CATEGORIES = Object.freeze([...CATEGORIES, REPORT_CATEGORY]);
const CONTACT_TOPICS = deepFreeze(CATEGORIES.filter(id => topics[id].formOrder)
  .sort((a, b) => topics[a].formOrder - topics[b].formOrder)
  .map(value => ({ value, label: topics[value].label })));
const TOPIC_LABEL = Object.freeze({
  ...Object.fromEntries(CATEGORIES.map(id => [id, topics[id].label])),
  [REPORT_CATEGORY]: "Player report",
});
const STATUS_LABEL = Object.freeze({ open: "Open", in_progress: "In progress", closed: "Closed" });
const STATUSES = Object.freeze(Object.keys(STATUS_LABEL));

module.exports = {
  CATEGORIES, CONTACT_TOPICS, INBOX_CATEGORIES, REPORT_CATEGORY, TOPIC_LABEL, STATUS_LABEL, STATUSES,
  MESSAGE_MIN: 5, MESSAGE_MAX: 4000,
  SUBJECT_MIN: 3, SUBJECT_MAX: 120,
  INBOX_PAGE_SIZE: 20,
};
