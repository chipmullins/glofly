// Mini games in chats (0.5.0): tic-tac-toe, word guess and trivia. A game is a message whose
// state changes with each move; the server checks every move with these same rules and keeps
// the secrets (the word, trivia answers) until they're out. Older apps see the body text.

export type GameKind = 'tictactoe' | 'wordguess' | 'trivia'

// ---- Tic-tac-toe ----

export type Mark = 'X' | 'O'
export type TicTacToe = {
  kind: 'tictactoe'
  /** X: whoever started it. O: the first other person to play (null until then). */
  x: string
  o: string | null
  /** 9 squares, left to right, top to bottom */
  board: ('' | Mark)[]
  turn: Mark
  winner: Mark | 'draw' | null
  /** The winning three squares */
  line: number[] | null
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

export function newTicTacToe(starter: string): TicTacToe {
  return { kind: 'tictactoe', x: starter, o: null, board: Array(9).fill(''), turn: 'X', winner: null, line: null }
}

/** A move by someone, or a reason it isn't allowed. */
export function playTicTacToe(g: TicTacToe, userId: string, square: number): TicTacToe | string {
  if (g.winner) return 'This game is over.'
  if (!Number.isInteger(square) || square < 0 || square > 8) return 'Pick a square.'
  if (g.board[square]) return 'That square is taken.'
  const o = g.o ?? (userId !== g.x ? userId : null)
  const mark: Mark | null = userId === g.x ? 'X' : userId === o ? 'O' : null
  if (!mark) return 'Only the two players can move.'
  if (!o && mark === 'X' && g.turn === 'O') return 'Waiting for someone to play O.'
  if (mark !== g.turn) return 'Not your turn yet.'
  const board = g.board.slice()
  board[square] = mark
  const line = LINES.find((l) => l.every((i) => board[i] === mark)) ?? null
  const winner = line ? mark : board.every(Boolean) ? 'draw' : null
  return { ...g, o, board, turn: mark === 'X' ? 'O' : 'X', winner, line }
}

// ---- Word guess (a five-letter word, everyone guesses together, six tries) ----

export type LetterMark = 'hit' | 'near' | 'miss'
export type WordGuess = {
  kind: 'wordguess'
  guesses: { userId: string; word: string; marks: LetterMark[] }[]
  maxGuesses: number
  solved: boolean
  over: boolean
  /** Only once it's over (the server keeps it until then) */
  answer: string | null
}

export const WORD_LENGTH = 5

/** How each letter of a guess compares with the answer (repeated letters counted properly). */
export function markGuess(guess: string, answer: string): LetterMark[] {
  const g = guess.toUpperCase().split('')
  const a = answer.toUpperCase().split('')
  const marks: LetterMark[] = g.map((ch, i) => (ch === a[i] ? 'hit' : 'miss'))
  const left: Record<string, number> = {}
  a.forEach((ch, i) => {
    if (g[i] !== ch) left[ch] = (left[ch] ?? 0) + 1
  })
  g.forEach((ch, i) => {
    if (marks[i] !== 'hit' && left[ch]) {
      marks[i] = 'near'
      left[ch]--
    }
  })
  return marks
}

export function newWordGuess(): WordGuess {
  return { kind: 'wordguess', guesses: [], maxGuesses: 6, solved: false, over: false, answer: null }
}

/** A guess, or why it isn't allowed. `answer` is the secret word. */
export function guessWord(g: WordGuess, userId: string, word: string, answer: string): WordGuess | string {
  if (g.over) return 'This game is over.'
  const w = word.trim().toUpperCase()
  if (!new RegExp(`^[A-Z]{${WORD_LENGTH}}$`).test(w)) return `Guess a ${WORD_LENGTH}-letter word.`
  if (g.guesses.some((x) => x.word === w)) return 'Someone already guessed that.'
  const marks = markGuess(w, answer)
  const guesses = [...g.guesses, { userId, word: w, marks }]
  const solved = marks.every((m) => m === 'hit')
  const over = solved || guesses.length >= g.maxGuesses
  return { ...g, guesses, solved, over, answer: over ? answer.toUpperCase() : null }
}

/** Answers the word guess game picks from: common, friendly five-letter words. */
export const WORDS: readonly string[] = (
  'ABOUT ABOVE ACORN ACTOR ADORE AFTER AGAIN AGREE AHEAD ALARM ALBUM ALERT ALIKE ALIVE ALLOW ALONE ' +
  'ALONG AMBER AMPLE ANGEL ANGLE ANKLE APPLE APRON ARENA ARGUE ARISE ARMOR AROMA ARROW ASIDE AWAKE ' +
  'AWARD BACON BADGE BAKER BASIC BEACH BEARD BEAST BEGIN BELLY BENCH BERRY BIRTH BLADE BLAME BLAND ' +
  'BLANK BLAST BLAZE BLEND BLINK BLOOM BLUSH BOARD BONUS BOOST BOOTH BRAIN BRAND BRAVE BREAD BREAK ' +
  'BRICK BRIDE BRIEF BRING BRISK BROOK BROOM BROWN BRUSH BUDDY BUILD BUNCH BURST CABIN CABLE CAMEL ' +
  'CANDY CANOE CARGO CAROL CARRY CATCH CEDAR CHAIN CHAIR CHALK CHARM CHART CHASE CHEAP CHECK CHEEK ' +
  'CHEER CHESS CHEST CHIEF CHILD CHILL CHIME CHIRP CHOIR CHUNK CIDER CLAIM CLASS CLEAN CLEAR CLERK ' +
  'CLICK CLIFF CLIMB CLOCK CLOSE CLOTH CLOUD CLOWN COACH COAST COCOA COMET COMIC CORAL COUCH COUNT ' +
  'COURT COVER CRAFT CRANE CRASH CRATE CRAZY CREAM CREEK CRISP CROWD CROWN CRUMB CRUSH CRUST CURLY ' +
  'CYCLE DAILY DAISY DANCE DEALT DECAY DELAY DELTA DENIM DEPTH DIARY DINER DITCH DIZZY DODGE DOUGH ' +
  'DRAFT DRAIN DRAMA DREAM DRESS DRIFT DRINK DRIVE EAGER EAGLE EARLY EARTH EASEL EIGHT ELBOW EMBER ' +
  'EMPTY ENJOY ENTER EQUAL ERUPT EVENT EVERY EXACT EXTRA FABLE FAIRY FAITH FALSE FANCY FAULT FEAST ' +
  'FENCE FERRY FEVER FIBER FIELD FIFTY FINAL FLAME FLASH FLOAT FLOCK FLOOD FLOOR FLOUR FLUTE FOCUS ' +
  'FORGE FOUND FRAME FRESH FRONT FROST FRUIT FUDGE FUNNY GIANT GLASS GLEAM GLIDE GLOBE GLOOM GLORY ' +
  'GLOVE GOOSE GRACE GRADE GRAIN GRAND GRAPE GRASS GREAT GREEN GREET GRILL GROUP GUARD GUESS GUEST ' +
  'GUIDE HAPPY HARSH HATCH HAVEN HEART HEAVY HEDGE HELLO HERON HOBBY HONEY HONOR HORSE HOTEL HOUSE ' +
  'HUMAN HUMOR HURRY IDEAL IGLOO IMAGE INDEX INNER IVORY JELLY JEWEL JOINT JOLLY JUDGE JUICE JUMBO ' +
  'KAYAK KNACK KNEEL KNIFE KNOCK KOALA LABEL LANCE LARGE LASER LAUGH LAYER LEARN LEMON LEVEL LIGHT ' +
  'LILAC LIMIT LINEN LLAMA LOBBY LOCAL LODGE LOGIC LOOSE LOYAL LUCKY LUNAR LUNCH MAGIC MAJOR MANGO ' +
  'MAPLE MARCH MATCH MAYOR MEDAL MELON MERCY MERRY METAL MIGHT MINOR MINUS MIXER MODEL MOIST MONEY ' +
  'MONTH MOOSE MORAL MOTOR MOUNT MOUSE MOUTH MOVIE MUDDY MUSIC NERVE NEVER NIGHT NINJA NOBLE NOISE ' +
  'NORTH NOVEL NURSE OCEAN OFFER OFTEN OLIVE ONION OPERA ORBIT ORDER OTHER OTTER OUNCE OUTER OWNER ' +
  'PAINT PANDA PANEL PAPER PARTY PASTA PATCH PEACE PEACH PEARL PEDAL PENNY PERCH PHONE PHOTO PIANO ' +
  'PILOT PINCH PIXEL PIZZA PLACE PLAIN PLANE PLANT PLATE PLAZA PLUSH POINT POLAR PORCH POUCH POWER ' +
  'PRESS PRICE PRIDE PRIME PRINT PRIZE PROUD PUPPY QUACK QUEEN QUEST QUICK QUIET QUILT RADAR RADIO ' +
  'RAINY RALLY RANCH RANGE RAPID RAVEN REACH READY REALM RELAX REPLY RIDER RIDGE RIGHT RIVER ROAST ' +
  'ROBIN ROBOT ROCKY ROUND ROUTE ROYAL RUSTY SALAD SANDY SAUCE SCALE SCARF SCENE SCOOP SCORE SCOUT ' +
  'SEVEN SHADE SHAKE SHARE SHARK SHARP SHEEP SHELF SHELL SHINE SHIRT SHORE SHORT SHOUT SIGHT SILLY ' +
  'SKATE SKILL SLEEP SLICE SLIDE SMALL SMART SMILE SMOKE SNACK SNAIL SNAKE SNOWY SOLAR SOLID SOUND ' +
  'SOUTH SPACE SPARK SPEAK SPEED SPICE SPOON SPORT SPRAY SQUAD STACK STAGE STAIR STAMP STAND STARE ' +
  'START STEAM STEEL STICK STILL STONE STORM STORY STOVE STRAW STRIP SUGAR SUNNY SUPER SWEET SWIFT ' +
  'SWING TABLE TASTE TEACH TEETH THANK THEME THICK THING THINK THREE THUMB TIGER TOAST TODAY TOPIC ' +
  'TORCH TOTAL TOUCH TOWEL TOWER TRACK TRADE TRAIL TRAIN TREAT TREND TRIBE TRICK TRULY TRUNK TRUST ' +
  'TRUTH TULIP TUNER TWIST ULTRA UNCLE UNDER UNION UNITY UPPER UPSET URBAN USUAL VALUE VAPOR VAULT ' +
  'VELVET VIDEO VIOLA VIRAL VISIT VITAL VIVID VOICE WAGON WATCH WATER WAVES WEARY WHALE WHEAT WHEEL ' +
  'WHILE WHIRL WHITE WHOLE WINDY WITTY WOMAN WORLD WORRY WRIST WRITE YACHT YEARN YOUNG YOUTH ZEBRA'
)
  .split(' ')
  .filter((w) => w.length === WORD_LENGTH)

// ---- Trivia (five questions; everyone answers, then the answer is shown) ----

export type TriviaQuestion = { q: string; choices: string[]; answer: number; category: string }
export type Trivia = {
  kind: 'trivia'
  /** The questions, without answers the server hasn't shown yet (answer -1) */
  questions: { q: string; choices: string[]; category: string; answer: number }[]
  /** The question being answered now (questions.length when over) */
  current: number
  /** Who picked what, per question */
  picks: { userId: string; question: number; choice: number }[]
  /** Who started it (can show the answer before everyone has picked) */
  host: string
  over: boolean
}

export const TRIVIA_COUNT = 5

/** Everyone who picked the right answer for each shown question, and each person's points. */
export function triviaScores(t: Trivia): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const p of t.picks) {
    const answer = t.questions[p.question]?.answer
    scores[p.userId] = (scores[p.userId] ?? 0) + (answer !== undefined && answer >= 0 && p.choice === answer ? 1 : 0)
  }
  return scores
}

/** A starting game from the full questions (with answers). The stored copy keeps the answers. */
export function newTrivia(host: string, picked: TriviaQuestion[]): Trivia {
  return {
    kind: 'trivia',
    questions: picked.map((x) => ({ q: x.q, choices: x.choices, category: x.category, answer: x.answer })),
    current: 0,
    picks: [],
    host,
    over: false
  }
}

/** Someone picks an answer to the current question, or why they can't. */
export function pickTrivia(t: Trivia, userId: string, question: number, choice: number): Trivia | string {
  if (t.over) return 'This game is over.'
  if (question !== t.current) return 'That question is finished.'
  if (!Number.isInteger(choice) || choice < 0 || choice >= (t.questions[question]?.choices.length ?? 0)) return 'Pick an answer.'
  if (t.picks.some((p) => p.userId === userId && p.question === question)) return 'You already answered.'
  return { ...t, picks: [...t.picks, { userId, question, choice }] }
}

/** Shows the current answer and moves on to the next question. */
export function revealTrivia(t: Trivia): Trivia {
  if (t.over) return t
  const current = t.current + 1
  return { ...t, current, over: current >= t.questions.length }
}

/**
 * What everyone sees: answers only for questions already shown, and who has answered the current
 * question but not what they picked (choice -1), so nobody can copy.
 */
export function publicTrivia(t: Trivia): Trivia {
  return {
    ...t,
    questions: t.questions.map((x, i) => (i < t.current ? x : { ...x, answer: -1 })),
    picks: t.picks.map((p) => (p.question < t.current ? p : { ...p, choice: -1 }))
  }
}

export type GameState = TicTacToe | WordGuess | Trivia

/** What everyone sees of a stored game (secrets removed). */
export function publicGame(g: GameState & { secret?: string }): GameState {
  if (g.kind === 'trivia') return publicTrivia(g)
  if (g.kind === 'wordguess') {
    const { secret: _secret, ...rest } = g as WordGuess & { secret?: string }
    return rest
  }
  return g
}

/** The plain-text version older apps show. */
export function gameFallback(kind: GameKind): string {
  const name = kind === 'tictactoe' ? 'tic-tac-toe' : kind === 'wordguess' ? 'a word guess game' : 'trivia'
  return `🎲 started ${name} — play it in the newest Glofly`
}

/** The trivia questions (a game picks five at random). */
export const TRIVIA: readonly TriviaQuestion[] = [
  { category: 'Nature', q: 'What do fireflies use their light for?', choices: ['Finding a mate', 'Seeing at night', 'Keeping warm', 'Scaring birds'], answer: 0 },
  { category: 'Nature', q: 'Which planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Mercury'], answer: 1 },
  { category: 'Nature', q: 'How many legs does a spider have?', choices: ['6', '8', '10', '12'], answer: 1 },
  { category: 'Nature', q: 'What is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3 },
  { category: 'Nature', q: 'What gas do plants take in from the air?', choices: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], answer: 2 },
  { category: 'Nature', q: 'Which animal is the fastest on land?', choices: ['Lion', 'Cheetah', 'Pronghorn', 'Horse'], answer: 1 },
  { category: 'Nature', q: 'What is the tallest kind of tree?', choices: ['Oak', 'Coast redwood', 'Baobab', 'Pine'], answer: 1 },
  { category: 'Nature', q: 'How many hearts does an octopus have?', choices: ['1', '2', '3', '4'], answer: 2 },
  { category: 'Nature', q: 'Which bird is known for mimicking human speech?', choices: ['Parrot', 'Owl', 'Crow', 'Robin'], answer: 0 },
  { category: 'Nature', q: 'What is the closest star to Earth?', choices: ['Sirius', 'Polaris', 'The Sun', 'Alpha Centauri'], answer: 2 },
  { category: 'Geography', q: 'What is the capital of Japan?', choices: ['Osaka', 'Kyoto', 'Tokyo', 'Seoul'], answer: 2 },
  { category: 'Geography', q: 'Which is the longest river in the world?', choices: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], answer: 1 },
  { category: 'Geography', q: 'What is the smallest country in the world?', choices: ['Monaco', 'Vatican City', 'San Marino', 'Malta'], answer: 1 },
  { category: 'Geography', q: 'Which continent is the Sahara Desert on?', choices: ['Asia', 'Australia', 'Africa', 'South America'], answer: 2 },
  { category: 'Geography', q: 'Mount Everest is on the border of Nepal and…', choices: ['India', 'China', 'Bhutan', 'Pakistan'], answer: 1 },
  { category: 'Geography', q: 'Which US state is known as the Bluegrass State?', choices: ['Tennessee', 'Kentucky', 'Virginia', 'Ohio'], answer: 1 },
  { category: 'Geography', q: 'What is the capital of Canada?', choices: ['Toronto', 'Vancouver', 'Montreal', 'Ottawa'], answer: 3 },
  { category: 'Geography', q: 'Which country has the most people?', choices: ['India', 'USA', 'China', 'Indonesia'], answer: 0 },
  { category: 'Geography', q: 'In which city is the Eiffel Tower?', choices: ['Rome', 'Paris', 'London', 'Madrid'], answer: 1 },
  { category: 'Geography', q: 'How many continents are there?', choices: ['5', '6', '7', '8'], answer: 2 },
  { category: 'Science', q: 'What is H2O better known as?', choices: ['Salt', 'Water', 'Hydrogen', 'Sugar'], answer: 1 },
  { category: 'Science', q: 'What part of the body pumps blood?', choices: ['Lungs', 'Liver', 'Heart', 'Kidneys'], answer: 2 },
  { category: 'Science', q: 'What is the hardest natural material?', choices: ['Gold', 'Iron', 'Diamond', 'Quartz'], answer: 2 },
  { category: 'Science', q: 'At what temperature does water freeze in Celsius?', choices: ['0°', '10°', '32°', '-10°'], answer: 0 },
  { category: 'Science', q: 'How many bones are in an adult human body?', choices: ['106', '206', '306', '186'], answer: 1 },
  { category: 'Science', q: 'Which planet has the most famous rings?', choices: ['Saturn', 'Neptune', 'Uranus', 'Mars'], answer: 0 },
  { category: 'Science', q: 'What do bees make?', choices: ['Milk', 'Silk', 'Honey', 'Wax only'], answer: 2 },
  { category: 'Science', q: 'What force keeps us on the ground?', choices: ['Magnetism', 'Gravity', 'Friction', 'Wind'], answer: 1 },
  { category: 'Science', q: 'Light travels faster than…', choices: ['Nothing', 'Sound', 'Thought', 'Time'], answer: 1 },
  { category: 'Science', q: 'What is the center of an atom called?', choices: ['Electron', 'Nucleus', 'Proton', 'Core'], answer: 1 },
  { category: 'Food', q: 'Which fruit has its seeds on the outside?', choices: ['Strawberry', 'Kiwi', 'Grape', 'Mango'], answer: 0 },
  { category: 'Food', q: 'What is the main ingredient in guacamole?', choices: ['Tomato', 'Avocado', 'Pepper', 'Lime'], answer: 1 },
  { category: 'Food', q: 'Which country did pizza come from?', choices: ['Greece', 'France', 'Italy', 'Spain'], answer: 2 },
  { category: 'Food', q: 'What is tofu made from?', choices: ['Rice', 'Soybeans', 'Wheat', 'Corn'], answer: 1 },
  { category: 'Food', q: 'Popcorn pops because of…', choices: ['Steam inside the kernel', 'Oil', 'Salt', 'Air outside'], answer: 0 },
  { category: 'Food', q: 'Which spice is the most expensive by weight?', choices: ['Vanilla', 'Saffron', 'Cinnamon', 'Pepper'], answer: 1 },
  { category: 'Food', q: 'What kind of food is cheddar?', choices: ['Bread', 'Cheese', 'Sausage', 'Pasta'], answer: 1 },
  { category: 'Food', q: 'Which nut is used to make marzipan?', choices: ['Peanut', 'Walnut', 'Almond', 'Cashew'], answer: 2 },
  { category: 'Pop culture', q: 'How many strings does a standard guitar have?', choices: ['4', '5', '6', '7'], answer: 2 },
  { category: 'Pop culture', q: 'Which game has a block-building world and creepers?', choices: ['Roblox', 'Minecraft', 'Terraria', 'Fortnite'], answer: 1 },
  { category: 'Pop culture', q: 'In chess, which piece can only move diagonally?', choices: ['Rook', 'Knight', 'Bishop', 'King'], answer: 2 },
  { category: 'Pop culture', q: 'How many players are on a soccer team on the field?', choices: ['9', '10', '11', '12'], answer: 2 },
  { category: 'Pop culture', q: 'How many squares are on a chessboard?', choices: ['32', '49', '64', '81'], answer: 2 },
  { category: 'Pop culture', q: 'What color do you get by mixing blue and yellow?', choices: ['Purple', 'Green', 'Orange', 'Brown'], answer: 1 },
  { category: 'Pop culture', q: 'Which instrument has 88 keys?', choices: ['Organ', 'Piano', 'Accordion', 'Harp'], answer: 1 },
  { category: 'Pop culture', q: 'How many days are in a leap year?', choices: ['364', '365', '366', '367'], answer: 2 },
  { category: 'History', q: 'Who painted the Mona Lisa?', choices: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Van Gogh'], answer: 1 },
  { category: 'History', q: 'Which ancient people built the pyramids of Giza?', choices: ['Romans', 'Greeks', 'Egyptians', 'Mayans'], answer: 2 },
  { category: 'History', q: 'What year did humans first land on the Moon?', choices: ['1959', '1969', '1979', '1989'], answer: 1 },
  { category: 'History', q: 'Who was the first President of the United States?', choices: ['Lincoln', 'Jefferson', 'Washington', 'Adams'], answer: 2 },
  { category: 'History', q: 'The Great Wall is in which country?', choices: ['Japan', 'China', 'India', 'Mongolia'], answer: 1 },
  { category: 'History', q: 'What did the Wright brothers invent?', choices: ['The car', 'The airplane', 'The telephone', 'The radio'], answer: 1 },
  { category: 'Words', q: 'What is the opposite of "ancient"?', choices: ['Old', 'Modern', 'Tired', 'Huge'], answer: 1 },
  { category: 'Words', q: 'Which word means "very happy"?', choices: ['Gloomy', 'Elated', 'Weary', 'Timid'], answer: 1 },
  { category: 'Words', q: 'How many letters are in the English alphabet?', choices: ['24', '25', '26', '27'], answer: 2 },
  { category: 'Words', q: 'A baby kangaroo is called a…', choices: ['Cub', 'Joey', 'Kit', 'Pup'], answer: 1 },
  { category: 'Words', q: 'What do you call a group of crows?', choices: ['A flock', 'A murder', 'A pack', 'A herd'], answer: 1 },
  { category: 'Words', q: 'Which of these is a palindrome?', choices: ['Level', 'Glow', 'Light', 'Spark'], answer: 0 }
]
