/** Retire only NameGen's former service worker, preserving all saved names. */
export function retireServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const scriptUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, location.origin).href;
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    for (const registration of registrations) {
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      if (worker?.scriptURL === scriptUrl) await registration.unregister();
    }
  }).catch(() => { /* Restricted storage must not block the website. */ });
}

