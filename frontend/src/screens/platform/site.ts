import { openChat } from '../../support/launcher';

export const SITE_TITLE = 'Azaria Bookings: booking sites for travel agencies';

export const SITE_DESCRIPTION =
  'Sell flights, tours and hotel stays from your own booking site and app. Azaria Bookings gives travel agencies ' +
  'their own address, colours and admin, one product or all three.';

export type SectionId = 'products' | 'flights' | 'tours' | 'hotels';

export const SECTION_LINKS: { id: SectionId; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'flights', label: 'Flights' },
  { id: 'tours', label: 'Tours' },
  { id: 'hotels', label: 'Hotels' },
];

const isSection = (value: string): value is SectionId => SECTION_LINKS.some((link) => link.id === value);

// Read before navigation starts, which may rewrite the address without its hash.
let pending: SectionId | null = (() => {
  const hash = typeof window !== 'undefined' && window.location ? window.location.hash.slice(1) : '';
  return isSection(hash) ? hash : null;
})();

/** Remembers a section for the home page to scroll to when it is shown (a bar link from /pricing). */
export function setPendingSection(id: SectionId) {
  pending = id;
}

/** The section waiting to be scrolled to, once. */
export function takePendingSection(): SectionId | null {
  const id = pending;
  pending = null;
  return id;
}

/** Scrolls the home page to a section and puts it in the address's hash, without a history entry. */
export function scrollToSection(id: SectionId, smooth = true) {
  if (typeof document === 'undefined') {
    return;
  }
  scrollPageTo(document.getElementById(id), smooth);
  window.history.replaceState(window.history.state, '', `/#${id}`);
}

/** Opens the platform desk's chat, prefilled as a getting-started enquiry. */
export function getStarted() {
  openChat({
    subject: 'Getting started with Azaria Bookings',
    message: 'I would like to get started with Azaria Bookings for my travel agency.',
  });
}

/** Back to the top of the home page, dropping the hash. */
export function scrollToTop() {
  if (typeof document === 'undefined') {
    return;
  }
  scrollPageTo(document.getElementById('top'), true);
  window.history.replaceState(window.history.state, '', '/');
}

/** Scrolls only the page's own scroll view (not the screens around it) so the element is at its top. */
function scrollPageTo(element: HTMLElement | null, smooth: boolean) {
  let view = element?.parentElement ?? null;
  while (view && !['auto', 'scroll'].includes(getComputedStyle(view).overflowY)) {
    view = view.parentElement;
  }
  if (element && view) {
    const top = view.scrollTop + element.getBoundingClientRect().top - view.getBoundingClientRect().top;
    // React Native Web replaces scrollTo on its scroll view's element with its own; use the browser's.
    const scrollTo = Element.prototype.scrollTo as (this: Element, options: ScrollToOptions) => void;
    scrollTo.call(view, { top, behavior: smooth ? 'smooth' : 'auto' });
  }
}
