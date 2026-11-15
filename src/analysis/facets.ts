import type { FacetAggregate, Session, SessionFacet } from "../schema/types.js";
import { bump, toCounts } from "./activity.js";

/**
 * Counts over the facets that belong to sessions in this report. Facets saved for
 * sessions outside the report's range would otherwise skew the totals.
 */
export function aggregateFacets(facets: SessionFacet[] | undefined, sessions: Session[]): FacetAggregate | null {
  if (!facets || facets.length === 0) return null;
  const known = new Set(sessions.map((session) => `${session.harness}\u0000${session.id}`));
  const latest = new Map<string, SessionFacet>();
  for (const facet of facets) {
    const key = `${facet.harness}\u0000${facet.sessionId}`;
    if (known.has(key)) latest.set(key, facet);
  }
  if (latest.size === 0) return null;

  const goals = new Map<string, number>();
  const types = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const helpfulness = new Map<string, number>();
  const satisfaction = new Map<string, number>();
  const frictions = new Map<string, number>();
  const successes = new Map<string, number>();
  for (const facet of latest.values()) {
    for (const goal of new Set(facet.goalCategories)) bump(goals, goal);
    bump(types, facet.sessionType);
    bump(outcomes, facet.outcome);
    bump(helpfulness, facet.helpfulness);
    bump(satisfaction, facet.satisfaction);
    if (facet.primarySuccess) bump(successes, facet.primarySuccess);
    for (const [friction, count] of Object.entries(facet.frictions)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) bump(frictions, friction, count);
    }
  }
  return {
    sessionsWithFacets: latest.size,
    goalCategories: toCounts(goals),
    sessionTypes: toCounts(types),
    outcomes: toCounts(outcomes),
    helpfulness: toCounts(helpfulness),
    satisfaction: toCounts(satisfaction),
    frictions: toCounts(frictions),
    successes: toCounts(successes),
  };
}
