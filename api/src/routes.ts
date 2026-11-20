// The API surface the Worker serves: every route the frontend still calls, mapped to its runtime-neutral handler
// module in backend/app/api. Modules are imported lazily, so a route's code (and any configuration it reads) loads
// only when that route is called.
//
// Routes deliberately NOT mounted (no frontend caller, no schedule; see docs/worker-routes.md): auth/login,
// admin/teams, the predictions root, legends, and the finished World Cup's test, matches, champion-predictors,
// sync/* and grade/* jobs.

// Handlers declare their own param shapes ({ team_id }, { path: string[] }); the router supplies them by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: { params: Promise<any> }) => Response | Promise<Response>;
export type RouteModule = Partial<Record<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS', Handler>>;
type Loader = () => Promise<RouteModule>;

// Order matters: static paths come before parameterised siblings (predictions/leaderboard before predictions/:match_id).
export const routes: [path: string, load: Loader][] = [
  // Public division data
  ['/home/dashboard', () => import('../../backend/app/api/home/dashboard/route')],
  ['/schedule', () => import('../../backend/app/api/schedule/route')],
  ['/standings', () => import('../../backend/app/api/standings/route')],
  ['/teams', () => import('../../backend/app/api/teams/route')],
  ['/teams/:team_id/matches', () => import('../../backend/app/api/teams/[team_id]/matches/route')],
  ['/players', () => import('../../backend/app/api/players/route')],
  ['/players/:player_id', () => import('../../backend/app/api/players/[player_id]/route')],
  ['/news', () => import('../../backend/app/api/news/route')],
  ['/leaderboard', () => import('../../backend/app/api/leaderboard/route')],
  // Division fantasy
  ['/predictions/leaderboard', () => import('../../backend/app/api/predictions/leaderboard/route')],
  ['/predictions/history', () => import('../../backend/app/api/predictions/history/route')],
  ['/predictions/:match_id', () => import('../../backend/app/api/predictions/[match_id]/route')],
  // Management (role checks are inside each handler and in the database)
  ['/admin/matches', () => import('../../backend/app/api/admin/matches/route')],
  ['/admin/matches/live', () => import('../../backend/app/api/admin/matches/live/route')],
  ['/admin/newsletter', () => import('../../backend/app/api/admin/newsletter/route')],
  ['/admin/newsletter/upload-url', () => import('../../backend/app/api/admin/newsletter/upload-url/route')],
  ['/admin/predictions/grade', () => import('../../backend/app/api/admin/predictions/grade/route')],
  ['/admin/predictions/regrade-all', () => import('../../backend/app/api/admin/predictions/regrade-all/route')],
  ['/admin/freshers/player-image', () => import('../../backend/app/api/admin/freshers/player-image/route')],
  ['/captain/team-branding', () => import('../../backend/app/api/captain/team-branding/route')],
  ['/profile/player-portrait', () => import('../../backend/app/api/profile/player-portrait/route')],
  // Media (home video HLS proxy); the remaining path is passed as segments, like Next's [...path]
  ['/media/*', () => import('../../backend/app/api/media/[...path]/route')],
  // World Cup: a finished, read-only archive. Behaviour is identical to the Next routes (submissions stay locked).
  ['/wc/flair', () => import('../../backend/app/api/wc/flair/route')],
  ['/wc/teams', () => import('../../backend/app/api/wc/teams/route')],
  ['/wc/players', () => import('../../backend/app/api/wc/players/route')],
  ['/wc/leaderboard', () => import('../../backend/app/api/wc/leaderboard/route')],
  ['/wc/predictions/groups', () => import('../../backend/app/api/wc/predictions/groups/route')],
  ['/wc/predictions/awards', () => import('../../backend/app/api/wc/predictions/awards/route')],
  ['/wc/predictions/knockouts', () => import('../../backend/app/api/wc/predictions/knockouts/route')],
  ['/wc/predictions/knockouts/generate', () => import('../../backend/app/api/wc/predictions/knockouts/generate/route')],
  ['/wc/predictions/knockouts/submit', () => import('../../backend/app/api/wc/predictions/knockouts/submit/route')],
];
