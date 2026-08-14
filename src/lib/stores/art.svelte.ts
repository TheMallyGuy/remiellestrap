/**
 * Bumped to force every mounted <BooruArt> slot to re-resolve its art
 * (e.g. after the Appearance page shuffles a slot or the cache is cleared).
 */
const counter = $state({ n: 0 });

export function getArtRefresh(): number {
  return counter.n;
}

export function refreshArt() {
  counter.n++;
}
