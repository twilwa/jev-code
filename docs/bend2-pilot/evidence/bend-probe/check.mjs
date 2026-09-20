import * as Bend from "../bend/bend2/bend.ts";
import * as Comp from "../bend/bend2/comp.ts";
const file = process.argv[2];
try {
  const book = Bend.book_nil();
  const seen = new Map();
  const n0 = await Bend.book_load(book, file, "", seen);
  console.log("PARSE+LOAD ok, n0 =", n0);
  Bend.book_valid(book, 0);
  console.log("TYPECHECK ok");
  Comp.book_owned(book, Comp.SYNTH);
  console.log("OWNERSHIP ok");
  console.log("hols =", book.hols, "open =", book.open);
} catch (e) {
  console.log("FAILED:", typeof e === "string" ? e.slice(0,600) : (e?.message ?? e));
  process.exitCode = 1;
}
