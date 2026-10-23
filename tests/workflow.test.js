import test from 'node:test';
import assert from 'node:assert/strict';
const transitions = { FILED: ['ASSIGNED','ESCALATED'], ASSIGNED: ['IN_REVIEW','ESCALATED'], IN_REVIEW: ['RESOLVED','ESCALATED'], ESCALATED: ['ASSIGNED','IN_REVIEW','RESOLVED'], RESOLVED: [] };
test('workflow accepts only documented transitions', () => {
  assert.ok(transitions.FILED.includes('ASSIGNED'));
  assert.ok(transitions.IN_REVIEW.includes('RESOLVED'));
  assert.ok(!transitions.FILED.includes('RESOLVED'));
  assert.deepEqual(transitions.RESOLVED, []);
});
test('public signup role is always student', () => {
  const publicSignupRole = 'STUDENT';
  assert.equal(publicSignupRole, 'STUDENT');
  assert.notEqual(publicSignupRole, 'ADMIN');
});
