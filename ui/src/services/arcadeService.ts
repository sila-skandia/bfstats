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
}

export interface AttributeMatch {
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

export async function fetchHigherLowerNext(serverGuid?: string, currentCandidate?: string): Promise<HigherLowerQuestion> {
  const params: Record<string, string> = {}
  if (serverGuid) params.serverGuid = serverGuid
  if (currentCandidate) params.currentCandidate = currentCandidate
  const res = await axios.get<HigherLowerQuestion>('/stats/arcade/higher-lower/next', { params })
  return res.data
}

export async function revealHigherLower(request: HigherLowerRevealRequest): Promise<HigherLowerRevealResult> {
  const res = await axios.post<HigherLowerRevealResult>('/stats/arcade/higher-lower/reveal', request)
  return res.data
}

export async function fetchDailyMystery(serverGuid?: string): Promise<MysteryDossier> {
  const params = serverGuid ? { serverGuid } : undefined
  const res = await axios.get<MysteryDossier>('/stats/arcade/mystery/today', { params })
  return res.data
}

export async function fetchRandomMystery(serverGuid?: string): Promise<MysteryDossier> {
  const params = serverGuid ? { serverGuid } : undefined
  const res = await axios.get<MysteryDossier>('/stats/arcade/mystery/random', { params })
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
}

export async function fetchTriviaQuiz(serverGuid?: string): Promise<TriviaQuiz> {
  const params = serverGuid ? { serverGuid } : undefined
  const res = await axios.get<TriviaQuiz>('/stats/arcade/trivia/quiz', { params })
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
