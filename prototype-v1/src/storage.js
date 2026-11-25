function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('flowtu-studio-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveLocal(data) {
  const db = await openDb()
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(data, 'current')
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
export async function loadLocal() {
  const db = await openDb()
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get('current')
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  }) } finally { db.close() }
}
