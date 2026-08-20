/**
 * dsh-knowledge-archives — host plugin.
 *
 * This plugin is deliberately **empty on the host side**, and that is its most
 * important property.
 *
 * A unified archive is a projection, not an authority. Every archived record
 * already has exactly one owner — Agenda, Bookmarks, Projects, Areas or
 * Resources — and each owner already enforces its own lifecycle, revision and
 * validation rules. Giving this plugin a storage unit or a write route would
 * create a second place that believes it knows what is archived, and the two
 * would eventually disagree.
 *
 * So there is no storage unit, no table, no API prefix and no request handler
 * here. The browser half reads each owner's existing same-origin state route
 * and calls each owner's existing restore endpoint. `inject` is empty because
 * there is nothing to inject: this module registers no route and touches no
 * backend.
 *
 * The `apply` below exists only so the package presents the standard Cordis
 * plugin surface the bundler and the profile installer expect. If a future
 * milestone ever needs host behaviour here, that is a new threat review, not an
 * edit to this file.
 */

const name = "dsh-knowledge-archives";
const inject = [];

/**
 * Intentionally does nothing.
 *
 * A test asserts this: the aggregate must never gain storage, a route or a
 * write endpoint, because restoring a record is the owning domain's decision.
 */
function apply() {}

export { apply, inject, name };
