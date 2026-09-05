import axios from 'axios'

export interface ArcadeServer {
  guid: string
  name: string
  country: string
  currentPlayers: number
  totalCandidates: number
  totalPlayTimeHours?: number
}

export interface Combatant {
  name: string
  country: string
  favoriteMap: string
  value?: number
  formattedValue?: string
}

export interface HigherLowerQuestion {
  metric: string
  metricLabel: string
  playerA: Combatant
  playerB: Combatant
  roundToken: string
  prompt?: string
  mapName?: string | null
}

export interface HigherLowerRevealRequest {
  roundToken: string
  guess: 'playerA' | 'playerB' | 'higher' | 'lower' | string
}

export interface HigherLowerRevealResult {
  isCorrect: boolean
  playerAValue: number
  playerBValue: number
  formattedPlayerBValue: string
  formattedPlayerAValue?: string
  message: string
  nextQuestion?: HigherLowerQuestion | null
}

export interface MysteryClue {
  key: string
  label: string
  value: string
  category?: string
}

export interface MysteryDossier {
  dossierToken: string
  mode: 'daily' | 'random'
  killsBracket: string
  playTimeBracket: string
  kdBracket: string
  favoriteMap: string
  favoriteServer: string
  signatureBadge?: string
  totalCandidates: number
  candidateOptions: string[]
  attributes?: MysteryClue[]
}

export interface AttributeMatch {
  value: string
  isMatch: boolean
  indicator?: 'match' | 'higher' | 'lower'
}

export interface MysteryAttributeMatch {
  key: string
  label: string
  value: string
  isMatch: boolean
  indicator?: 'match' | 'higher' | 'lower'
}

export interface MysteryGuessResult {
  guessedPlayerName: string
  isCorrect: boolean
  kills: AttributeMatch
  playTime: AttributeMatch
  kdRatio: AttributeMatch
  favoriteMap: AttributeMatch
  favoriteServer: AttributeMatch
  targetPlayerName?: string
  message?: string
  attributes?: MysteryAttributeMatch[]
}

export interface MysteryConcedeResult {
  targetPlayerName: string
  message: string
}

export interface TriviaQuestion {
  id: string
  category: string
  question: string
  options: string[]
  targetPlayerName?: string
  targetRoundId?: string
  targetMapName?: string
  targetServerName?: string
  highlights?: string[]
}

export interface TriviaQuiz {
  quizToken: string
  questions: TriviaQuestion[]
}

export interface TriviaQuestionResult {
  questionId: string
  question: string
  selectedAnswer: string
  correctAnswer: string
  isCorrect: boolean
  explanation: string
  targetPlayerName?: string
  targetRoundId?: string
  targetMapName?: string
  targetServerName?: string
  highlights?: string[]
}

export interface TriviaQuizResult {
  totalQuestions: number
  correctCount: number
  scorePercentage: number
  rankTitle: string
  summaryMessage: string
  questionResults: TriviaQuestionResult[]
}

export interface ArcadePlayerSearchItem {
  name: string
  country: string
  playTimeHours: number
  kdRatio: number
}

export async function fetchArcadeServers(): Promise<ArcadeServer[]> {
  const res = await axios.get<ArcadeServer[]>('/stats/arcade/servers')
  return res.data
}

const MAX_SAFE_ARCADE_ERROR = 180

export function arcadeLoadError(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err) || typeof err.response?.data !== 'string') {
    return fallback
  }

  const text = err.response.data.trim()
  if (!text || text.length > MAX_SAFE_ARCADE_ERROR || looksLikeRawException(text)) {
    return fallback
  }

  return text
}

function looksLikeRawException(text: string): boolean {
  if (text.includes('\n') || text.includes('\r')) return true
  return /Exception:|stack trace|HEADERS\s*=+|at\s+\S+\.\S+\(/i.test(text)
}

function arcadeParams(serverGuid?: string, orbitPlayer?: string, extra?: Record<string, string>): Record<string, string> {
  const params: Record<string, string> = { ...extra }
  if (serverGuid) params.serverGuid = serverGuid
  if (orbitPlayer) params.orbitPlayer = orbitPlayer
  return params
}

export async function fetchHigherLowerNext(
  serverGuid?: string,
  currentCandidate?: string,
  orbitPlayer?: string
): Promise<HigherLowerQuestion> {
  const extra: Record<string, string> = {}
  if (currentCandidate) extra.currentCandidate = currentCandidate
  const res = await axios.get<HigherLowerQuestion>('/stats/arcade/higher-lower/next', {
    params: arcadeParams(serverGuid, orbitPlayer, extra)
  })
  return res.data
}

export async function revealHigherLower(request: HigherLowerRevealRequest): Promise<HigherLowerRevealResult> {
  const res = await axios.post<HigherLowerRevealResult>('/stats/arcade/higher-lower/reveal', request)
  return res.data
}

export async function fetchDailyMystery(serverGuid?: string, orbitPlayer?: string): Promise<MysteryDossier> {
  const res = await axios.get<MysteryDossier>('/stats/arcade/mystery/today', {
    params: arcadeParams(serverGuid, orbitPlayer)
  })
  return res.data
}

export async function fetchRandomMystery(
  serverGuid?: string,
  orbitPlayer?: string,
  exclude?: string
): Promise<MysteryDossier> {
  const extra: Record<string, string> = {}
  if (exclude) extra.exclude = exclude
  const res = await axios.get<MysteryDossier>('/stats/arcade/mystery/random', {
    params: arcadeParams(serverGuid, orbitPlayer, extra)
  })
  return res.data
}

export async function submitMysteryGuess(
  dossierToken: string,
  guessedPlayerName: string
): Promise<MysteryGuessResult> {
  const res = await axios.post<MysteryGuessResult>('/stats/arcade/mystery/guess', {
    dossierToken,
    guessedPlayerName
  })
  return res.data
}

export async function revealMysterySoldier(
  dossierToken: string
): Promise<MysteryConcedeResult> {
  const res = await axios.post<MysteryConcedeResult>('/stats/arcade/mystery/reveal', {
    dossierToken
  })
  return res.data
}

export interface TriviaQuestionVerification {
  questionId: string
  isCorrect: boolean
  selectedAnswer: string
  correctAnswer: string
  explanation: string
  targetPlayerName?: string
  targetRoundId?: string
  targetMapName?: string
  targetServerName?: string
  highlights?: string[]
}

export async function fetchTriviaQuiz(serverGuid?: string, orbitPlayer?: string): Promise<TriviaQuiz> {
  const res = await axios.get<TriviaQuiz>('/stats/arcade/trivia/quiz', {
    params: arcadeParams(serverGuid, orbitPlayer)
  })
  return res.data
}

export async function verifyTriviaQuestion(
  quizToken: string,
  questionId: string,
  answer: string
): Promise<TriviaQuestionVerification> {
  const res = await axios.post<TriviaQuestionVerification>('/stats/arcade/trivia/verify-question', {
    quizToken,
    questionId,
    answer
  })
  return res.data
}

export async function verifyTriviaQuiz(
  quizToken: string,
  answers: Record<string, string>
): Promise<TriviaQuizResult> {
  const res = await axios.post<TriviaQuizResult>('/stats/arcade/trivia/verify', {
    quizToken,
    answers
  })
  return res.data
}

export async function searchArcadePlayers(
  query: string,
  serverGuid?: string,
  limit: number = 10
): Promise<ArcadePlayerSearchItem[]> {
  const params: Record<string, string | number> = { query, limit }
  if (serverGuid) params.serverGuid = serverGuid
  const res = await axios.get<ArcadePlayerSearchItem[]>('/stats/arcade/players/search', { params })
  return res.data
}
