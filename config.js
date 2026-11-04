/* ============================================================
   CONFIGURACIÓN DE SAFETYALERT  (el único archivo que debes editar)
   Reemplaza los valores entre comillas con los tuyos.
   Estos datos NO son secretos (Firebase los hace públicos a propósito).
   ============================================================ */
globalThis.SA_CONFIG = {
  // URL de la "Aplicación web" de Apps Script (termina en /exec)
    API_URL: 'https://script.google.com/macros/s/AKfycbyo4AozGk_0bWAZyk7QUjkeN6xt1tEKINtlX4RoUXUuMI0VobrNCT65-MqK26Kpf3EG4Q/exec',

  // Firebase > Configuración del proyecto > General > Tus apps > Configuración del SDK
  firebase: {
      apiKey: "AIzaSyDadGqGP0HNHoPxhYuVKajbWjI6cdUFqBI",
      authDomain: "safetyalert-13035.firebaseapp.com",
      projectId: "safetyalert-13035",
      storageBucket: "safetyalert-13035.firebasestorage.app",
      messagingSenderId: "313157598",
      appId: "1:313157598:web:eccc6dd6a0e28feaa61f4f",
      measurementId: "G-P8RK4FXTG2"
  },

  // Firebase > Configuración > Cloud Messaging > Certificados push web > Par de claves
    vapidKey: 'BJIZjMnuUj7xH-pVfr5b_I9AXJmhJ7Ucvux9Z2cijgTQe0scpFByl-ihqifTPCzeVkiSnWFiaiwT6yiYkBr4TU0',

  // Nombre que se muestra en la app
  empresa: 'Cervecería Hondureña'
};
