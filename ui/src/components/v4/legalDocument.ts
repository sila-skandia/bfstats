/**
 * Shared types for the legal pages (Terms, Privacy). Lives outside the SFC
 * because `<script setup>` cannot carry ES module exports.
 */
export interface LegalSection {
  /** Anchor id — must match the `id` on the corresponding <h2> in the page body. */
  id: string
  /** Label shown in the contents rail. */
  title: string
}
