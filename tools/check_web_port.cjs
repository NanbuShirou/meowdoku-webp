const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const web = root;
const read = (name) => fs.readFileSync(path.join(web, name), "utf8");
const html = read("index.html");
const game = read("game.js");
const css = read("styles.css");
const settingsPages = read("settings-pages.js");
const sound = read("sound.js");
const index = JSON.parse(read("levels_index.json"));

assert.ok(!fs.existsSync(path.join(web, "bgm")));
assert.ok(!fs.existsSync(path.join(web, "music.js")));
assert.doesNotMatch(`${html}\n${game}`, /MeowdokuAndroid|music\.js|btn-(?:home|settings)-exit|btn-upload-board|board-upload/);
assert.doesNotMatch(`${html}\n${settingsPages}`, /settings-page-3|page3/);
assert.match(settingsPages, /Math\.min\(2, page\)/);
assert.match(game, /closeSaveProgressConfirm\(\);\s*showAppScreen\("home"\)/);
assert.match(sound, /new Audio\("raw\/button\.wav"\)/);
assert.match(sound, /new Audio\("raw\/meow\.wav"\)/);
assert.match(game, /levels\/normal/);
assert.match(game, /levels\/hard/);
assert.match(game, /levels\/extra/);
assert.match(html, /styles\.css\?v=2\.0\.3/);
assert.match(html, /game\.js\?v=2\.0\.2/);
assert.doesNotMatch(html, /world-map-indicator[^>]*aria-hidden/);
assert.match(game, /document\.createElement\("button"\)[\s\S]*?className = "world-map-dot"/);
assert.match(game, /Math\.ceil\(frameWidth\) - frameWidth/);
assert.doesNotMatch(game, /height \* 4 \/ 49/);
assert.match(html, /id="loading-overlay"/);
assert.match(html, /id="game-map-background-preload"/);
assert.match(html, /images\/UI\/background\.png/);
assert.match(css, /--theme-background-image: url\("images\/UI\/background\.png"\)/);
assert.match(game, /function startScreenLoading\(\)/);
assert.match(game, /function finishScreenLoading\(root, token\)/);
assert.match(game, /image\.decode\?\.\(\)/);
assert.match(game, /selectWorldMapPage\(pageIndex\);\s*finishScreenLoading\(el\.screenWorldMap, loadingToken\)/);
assert.match(game, /function v2GameBackground\(size, mode\)/);
assert.match(game, /setProperty\("--game-map-background-image"/);
assert.match(css, /body\[data-app-screen="game"\]::after[\s\S]*?center \/ contain no-repeat var\(--game-map-background-image\)/);
assert.doesNotMatch(css, /body\[data-app-screen="(?:world-map|small-map)"\]::before/);
assert.match(css, /\.map-screen\s*\{[\s\S]*?background: transparent/);

const played = [];
class FakeAudio {
  constructor(source) { this.source = source; this.currentTime = 1; }
  play() { played.push(this.source); return Promise.resolve(); }
}
const soundContext = { Audio: FakeAudio };
soundContext.globalThis = soundContext;
vm.runInNewContext(sound, soundContext);
const soundManager = new soundContext.SoundManager();
soundManager.playButton();
soundManager.playMeow();
assert.deepEqual(played, ["raw/button.wav", "raw/meow.wav"]);

for (const name of ["index.html", "styles.css", "themes/default.css", "themes/cell-styles.css"]) {
  const file = path.join(web, name);
  const source = fs.readFileSync(file, "utf8");
  const references = name.endsWith(".html")
    ? [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    : [...source.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(?:data:|https?:|#)/.test(reference)) continue;
    const localReference = reference.split(/[?#]/, 1)[0];
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), localReference)), `${name}: missing ${reference}`);
  }
}

function checkLevel(file, size) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  assert.equal(Number(lines[0]), size, `${file}: wrong size`);
  assert.equal(lines.slice(1, size + 1).filter((row) => row.length === size).length, size, `${file}: invalid board`);
  const solution = lines.find((line) => line.startsWith("# solution:"))
    ?.slice("# solution:".length).trim().split(/\s+/).map(Number);
  assert.equal(solution?.length, size, `${file}: invalid solution`);
  assert.equal(new Set(solution).size, size, `${file}: repeated solution column`);
}

let total = 0;
for (const difficulty of ["normal", "hard"]) {
  for (let size = 6; size <= 12; size++) {
    const baseExpected = 100;
    const baseDir = path.join(root, "levels", difficulty, `${size}x${size}`);
    const baseFiles = fs.readdirSync(baseDir).filter((name) => name.endsWith(".txt"));
    assert.equal(baseFiles.length, baseExpected);
    baseFiles.forEach((name) => checkLevel(path.join(baseDir, name), size));
    assert.equal(Number(index.sizes[String(size)]), baseExpected);
    total += baseExpected;

    const extraExpected = 200;
    const extraDir = path.join(root, "levels", "extra", difficulty, `${size}x${size}`);
    const extraFiles = fs.readdirSync(extraDir).filter((name) => name.endsWith(".txt"));
    assert.equal(extraFiles.length, extraExpected);
    extraFiles.forEach((name) => checkLevel(path.join(extraDir, name), size));
    assert.equal(Number(index.extras[difficulty][String(size)]), extraExpected);
    total += extraExpected;
  }
}

assert.equal(total, 4200);
console.log("Web port check passed: 4,200 static levels, no BGM/upload/exit bridge.");
