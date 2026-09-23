// The map page's wiring helpers: how a module's `page` bag is written.
//
// Every page module is a factory `createX(page)`; `page` names exactly what the
// module reads of the rest of the page, as live getters (features/
// vehicle-instance-refactor, Parts 2 and 2b). Most of those getters read one
// member of another module, so a bag is written as its dependencies grouped by
// owner:
//
//   createX(bag(
//     from(() => localPlayer, 'occupancy soldier'),
//     from(() => deployScreen, 'easeOpen:easeDeployOpen'),
//     { get camera() { return camera; } },
//   ))
//
// The owner is a thunk so a module created further down the page is read when
// the getter runs, not when the bag is built. `name:alias` hands `owner.name`
// in as `alias`. Nothing here caches: every read goes to the owner, which is
// what lets an owner replace a field and every reader see it.

/** Live getters for the named members of `owner()`. */
export function from(owner, names) {
  const out = {};
  for (const item of names.trim().split(/\s+/)) {
    const [name, alias = name] = item.split(':');
    Object.defineProperty(out, alias, {
      get: () => owner()[name],
      enumerable: true,
      configurable: true,
    });
  }
  return out;
}

/** One bag out of several parts, keeping their getters as getters. */
export function bag(...parts) {
  const descriptors = {};
  for (const part of parts) Object.assign(descriptors, Object.getOwnPropertyDescriptors(part));
  return Object.defineProperties({}, descriptors);
}
