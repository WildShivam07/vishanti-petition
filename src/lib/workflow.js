export const STATUSES = ['FILED', 'ASSIGNED', 'IN_REVIEW', 'RESOLVED', 'ESCALATED'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const CATEGORIES = ['Academic', 'Hostel', 'Infrastructure', 'Harassment', 'Finance', 'IT Services', 'Other'];

// Shared UI helper only. The trusted Edge Function and database also enforce transitions.
export const TRANSITIONS = {
  FILED: ['ASSIGNED', 'ESCALATED'],
  ASSIGNED: ['IN_REVIEW', 'ESCALATED'],
  IN_REVIEW: ['RESOLVED', 'ESCALATED'],
  ESCALATED: ['ASSIGNED', 'IN_REVIEW', 'RESOLVED'],
  RESOLVED: []
};
export const statusLabel = (status = '') => status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
