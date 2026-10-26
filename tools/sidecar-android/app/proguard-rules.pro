# The sidecar is reached by reflection nowhere, but keep names readable in
# logs and crash traces; R8 still runs, which is what catches a JVM-only class.
-dontobfuscate
-keep class io.bfstats.sidecar.** { *; }
-keepattributes SourceFile,LineNumberTable
