/**
 * Models love writing :fire: and :blush: instead of the emoji itself. This turns the common
 * GitHub-style shortcodes into real emoji for display, leaving code blocks and anything we
 * don't recognise (like "10:30:45") untouched.
 */
const SHORTCODES: Record<string, string> = {
  smile: "😄", grin: "😁", grinning: "😀", smiley: "😃", laughing: "😆", joy: "😂", rofl: "🤣",
  blush: "😊", wink: "😉", slight_smile: "🙂", upside_down: "🙃", relieved: "😌", sweat_smile: "😅",
  heart_eyes: "😍", star_struck: "🤩", kissing_heart: "😘", yum: "😋", stuck_out_tongue: "😛",
  thinking: "🤔", thinking_face: "🤔", shushing_face: "🤫", raised_eyebrow: "🤨", neutral_face: "😐",
  smirk: "😏", unamused: "😒", roll_eyes: "🙄", grimacing: "😬", pensive: "😔", sleepy: "😪",
  sleeping: "😴", sunglasses: "😎", nerd: "🤓", nerd_face: "🤓", hugs: "🤗", cry: "😢", sob: "😭",
  scream: "😱", fearful: "😨", cold_sweat: "😰", angry: "😠", rage: "😡", exploding_head: "🤯",
  dizzy_face: "😵", mask: "😷", skull: "💀", ghost: "👻", alien: "👽", robot: "🤖", clown: "🤡",
  poop: "💩", see_no_evil: "🙈", hear_no_evil: "🙉", speak_no_evil: "🙊",
  "+1": "👍", thumbsup: "👍", "-1": "👎", thumbsdown: "👎", clap: "👏", wave: "👋", ok_hand: "👌",
  pray: "🙏", muscle: "💪", point_right: "👉", point_left: "👈", point_up: "☝️", raised_hands: "🙌",
  handshake: "🤝", fist: "✊", v: "✌️", eyes: "👀", brain: "🧠", tongue: "👅",
  heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚", blue_heart: "💙",
  purple_heart: "💜", black_heart: "🖤", broken_heart: "💔", sparkling_heart: "💖",
  fire: "🔥", sparkles: "✨", star: "⭐", star2: "🌟", zap: "⚡", boom: "💥", collision: "💥",
  tada: "🎉", confetti_ball: "🎊", balloon: "🎈", gift: "🎁", trophy: "🏆", medal: "🏅",
  rocket: "🚀", airplane: "✈️", car: "🚗", bulb: "💡", mag: "🔍", lock: "🔒", unlock: "🔓", key: "🔑",
  hammer: "🔨", wrench: "🔧", gear: "⚙️", link: "🔗", pushpin: "📌", paperclip: "📎",
  memo: "📝", pencil: "📝", book: "📖", books: "📚", bookmark: "🔖", calendar: "📅", clipboard: "📋",
  chart_with_upwards_trend: "📈", chart: "📊", email: "📧", envelope: "✉️", inbox_tray: "📥",
  computer: "💻", keyboard: "⌨️", desktop: "🖥️", phone: "📱", battery: "🔋", floppy_disk: "💾",
  cd: "💿", microphone: "🎤", headphones: "🎧", musical_note: "🎵", guitar: "🎸", video_game: "🎮",
  game_die: "🎲", art: "🎨", camera: "📷", movie_camera: "🎥", clapper: "🎬",
  coffee: "☕", tea: "🍵", beer: "🍺", pizza: "🍕", hamburger: "🍔", cake: "🍰", cookie: "🍪",
  apple: "🍎", banana: "🍌", taco: "🌮", popcorn: "🍿",
  cat: "🐱", dog: "🐶", penguin: "🐧", unicorn: "🦄", snake: "🐍", turtle: "🐢", bug: "🐛",
  sun: "☀️", cloud: "☁️", rainbow: "🌈", snowflake: "❄️", ocean: "🌊", earth_americas: "🌎",
  moon: "🌙", full_moon: "🌕", crystal_ball: "🔮", gem: "💎", moneybag: "💰", dollar: "💵",
  white_check_mark: "✅", check: "✔️", heavy_check_mark: "✔️", x: "❌", warning: "⚠️", no_entry: "⛔",
  question: "❓", exclamation: "❗", bangbang: "‼️", 100: "💯", zzz: "💤", hourglass: "⏳",
  alarm_clock: "⏰", stopwatch: "⏱️", bell: "🔔", mega: "📣", package: "📦", construction: "🚧",
  arrow_right: "➡️", arrow_left: "⬅️", arrow_up: "⬆️", arrow_down: "⬇️", recycle: "♻️",
  shrug: "🤷", facepalm: "🤦", point_down: "👇", thought_balloon: "💭", speech_balloon: "💬",
};

const CODE_SPAN = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;
const SHORTCODE = /:([a-z0-9_+-]{1,40}):/gi;

export function replaceEmojiShortcodes(text: string): string {
  if (!text.includes(":")) return text;
  // Odd entries of the split are the code spans; leave those exactly as written.
  return text
    .split(CODE_SPAN)
    .map((piece, i) =>
      i % 2 === 1
        ? piece
        : piece.replace(SHORTCODE, (whole, name: string) => SHORTCODES[name.toLowerCase()] ?? whole),
    )
    .join("");
}
