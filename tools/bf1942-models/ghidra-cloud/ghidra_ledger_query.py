# Read back what ghidra_ledger.py wrote. Changes nothing, so apply_labels.py
# reports UNCHANGED and the project is not saved.
#
#   BFSTATS_LEDGER_QUERY=0x08163dd0,0x08163fd6 python3 apply_labels.py \
#       <project_dir> <project> <program> ghidra_ledger_query.py
#   features/bf1942-engine-reference/annotate.py <project_dir> <project> --query 0x08163dd0,0x08163fd6
#
# With BFSTATS_FUNC_DUMP=<file> it instead writes the program's function table
# ("entry last-byte" per line), which is how client-functions.txt is made.
#@category bfstats

import os

try:
    from ghidra.program.model.listing import CommentType
    KINDS = [("plate", CommentType.PLATE), ("pre", CommentType.PRE), ("eol", CommentType.EOL)]
except ImportError:
    from ghidra.program.model.listing import CodeUnit
    KINDS = [("plate", CodeUnit.PLATE_COMMENT), ("pre", CodeUnit.PRE_COMMENT), ("eol", CodeUnit.EOL_COMMENT)]

TAG = "[bfstats]"
program = currentProgram
listing = program.getListing()
space = program.getAddressFactory().getDefaultAddressSpace()
marks = program.getBookmarkManager()

dump = os.environ.get("BFSTATS_FUNC_DUMP")
if dump:
    n = 0
    with open(dump, "w") as f:
        for fn in program.getFunctionManager().getFunctions(True):
            e = fn.getEntryPoint()
            if e.getAddressSpace() != space:
                continue
            f.write("%08x %08x\n" % (e.getOffset(), fn.getBody().getMaxAddress().getOffset()))
            n += 1
    println("wrote %d functions to %s" % (n, dump))

for kind_name, kind in KINDS[:2]:
    n = 0
    it = listing.getCommentAddressIterator(kind, program.getMemory(), True)
    while it.hasNext():
        text = listing.getComment(kind, it.next())
        if text and TAG in text:
            n += 1
    println("TOTAL %s comments carrying %s: %d" % (kind_name, TAG, n))
n, cats = 0, set()
it = marks.getBookmarksIterator("bfstats")
while it.hasNext():
    b = it.next()
    n += 1
    cats.add(str(b.getCategory()))
println("TOTAL bfstats bookmarks: %d in %d categories" % (n, len(cats)))

for q in [q for q in os.environ.get("BFSTATS_LEDGER_QUERY", "").split(",") if q.strip()]:
    va = int(q, 16)
    addr = space.getAddress(va)
    fn = program.getFunctionManager().getFunctionContaining(addr)
    sym = program.getSymbolTable().getPrimarySymbol(addr)
    println("")
    println("=== 0x%08x" % va)
    if fn is not None:
        off = va - fn.getEntryPoint().getOffset()
        println("function: %s%s" % (fn.getName(True), "" if off == 0 else " +0x%x" % off))
    else:
        println("function: none")
    println("symbol:   %s" % ("%s (%s)" % (sym.getName(True), sym.getSource()) if sym is not None else "none"))
    for kind_name, kind in KINDS:
        text = listing.getComment(kind, addr)
        if text:
            println("%s comment:" % kind_name)
            for line in text.split("\n"):
                println("    " + line)
    for b in marks.getBookmarks(addr):
        println("bookmark: type=%s category=%s  %s" % (b.getTypeString(), b.getCategory(), b.getComment()))
