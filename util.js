'use strict';

// Returns the number of seconds since the Unix epoch.
export function epoch() {
  return Math.floor(new Date() / 1000);
}
