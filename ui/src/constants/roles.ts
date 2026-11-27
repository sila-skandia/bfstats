/** Role constants; must match backend api.Authorization.AppRoles */
export const ROLE_USER = 'User';
export const ROLE_SUPPORT = 'Support';
/** Early access testers (features/early-access-sidecar); Admin has the same access, Support does not. */
export const ROLE_EARLY_ADOPTER = 'EarlyAdopter';
export const ROLE_ADMIN = 'Admin';
/** Runs BattleView Vietnam's Shorts (features/bfv-through-bfstats): its Shorts only, from any sign-in. */
export const ROLE_BFV_ADMIN = 'BfvAdmin';
