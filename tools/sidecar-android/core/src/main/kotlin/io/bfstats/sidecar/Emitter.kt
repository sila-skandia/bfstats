package io.bfstats.sidecar

// Node's EventEmitter, as far as the ported modules use it: named events,
// listeners called in the order they were added, synchronously, with the
// emit's arguments. A module's events and their arguments are the Node copy's,
// so `emit("status", row)` here is `this.emit('status', row)` there.

typealias Listener = (List<Any?>) -> Unit

open class Emitter {
  private val listeners = LinkedHashMap<String, MutableList<Listener>>()

  fun on(event: String, fn: Listener): Emitter {
    listeners.getOrPut(event) { mutableListOf() }.add(fn)
    return this
  }

  fun off(event: String, fn: Listener) { listeners[event]?.remove(fn) }

  /** True when a listener heard it, as EventEmitter#emit. */
  fun emit(event: String, vararg args: Any?): Boolean {
    val ls = listeners[event]?.toList() ?: return false
    if (ls.isEmpty()) return false
    val a = args.toList()
    for (l in ls) l(a)
    return true
  }

  fun listenerCount(event: String): Int = listeners[event]?.size ?: 0
}
