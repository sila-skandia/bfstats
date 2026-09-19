// Decompile a list of functions (one hex address per line, optional label after whitespace) to files.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class DumpDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String listFile = args[0];
        String outDir = args[1];
        Files.createDirectories(Paths.get(outDir));
        println("functions in program: " + currentProgram.getFunctionManager().getFunctionCount());
        DecompInterface di = new DecompInterface();
        DecompileOptions opts = new DecompileOptions();
        di.setOptions(opts);
        di.openProgram(currentProgram);
        List<String> lines = Files.readAllLines(Paths.get(listFile));
        int ok = 0, bad = 0;
        for (String line : lines) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split("\\s+", 2);
            Address a = currentProgram.getAddressFactory().getAddress(parts[0].replace("0x", ""));
            Function f = getFunctionAt(a);
            if (f == null) {
                new DisassembleCommand(a, null, true).applyTo(currentProgram, monitor);
                f = createFunction(a, null);
            }
            if (f == null) { println("NOFUNC " + line); bad++; continue; }
            DecompileResults r = di.decompileFunction(f, 180, monitor);
            String name = parts[0].replace("0x", "").toLowerCase();
            Path p = Paths.get(outDir, name + ".c");
            StringBuilder sb = new StringBuilder();
            sb.append("// ").append(f.getName(true)).append(" @ ").append(a).append("  size=")
              .append(f.getBody().getNumAddresses()).append("\n");
            sb.append("// ").append(f.getPrototypeString(true, true)).append("\n");
            if (r != null && r.decompileCompleted()) {
                sb.append(r.getDecompiledFunction().getC());
                ok++;
            } else {
                sb.append("// DECOMPILE FAILED: ").append(r == null ? "null" : r.getErrorMessage()).append("\n");
                bad++;
            }
            Files.writeString(p, sb.toString());
        }
        println("decompiled ok=" + ok + " bad=" + bad);
    }
}
