import * as Bend from "../bend/bend2/bend.ts";
import * as Comp from "../bend/bend2/comp.ts";
const file = process.argv[2];
const err = (e) => {
  if (typeof e === "string") return e.slice(0, 400);
  if (e && e.$ === "Err") {
    const j = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
    return "Err exp=" + j(e.exp) + " obs=" + j(e.obs) + (e.ctx ? " ctx=" + j(e.ctx) : "");
  }
  return e?.message ?? String(e);
};
try {
  const book = Bend.book_nil();
  const n0 = await Bend.book_load(book, file, "", new Map());
  console.log("  PARSE   ok (n0=" + n0 + ")");
  try {
    Bend.book_valid(book, 0);
    console.log("  TYPE    ok");
  } catch (e) { console.log("  TYPE    FAIL " + err(e)); process.exitCode = 1; throw "stop"; }
  try {
    Comp.book_owned(book, Comp.SYNTH);
    console.log("  OWNED   ok");
  } catch (e) { console.log("  OWNED   FAIL " + err(e)); process.exitCode = 1; throw "stop"; }
  console.log("  HOLES   hols=" + book.hols + " open=" + book.open);
} catch (e) {
  if (e !== "stop") { console.log("  PARSE   FAIL " + err(e)); process.exitCode = 1; }
}
