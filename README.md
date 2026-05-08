# FitTracker Pro

App de gestión para entrenador personal. HTML/JS puro + Firebase.

## Archivos

```
fittracker/
├── index.html          ← App principal
├── styles.css          ← Estilos responsive
├── app.js              ← Toda la lógica
├── firebase-config.js  ← TUS credenciales de Firebase (no subir a git público)
├── manifest.json       ← Para instalar como app en móvil
└── README.md
```

## Configuración inicial (solo una vez)

### 1. Firebase
1. Ve a https://console.firebase.google.com
2. Tu proyecto → Configuración ⚙️ → Tu app web
3. Copia los valores en `firebase-config.js`
4. En Firebase Console activa:
   - **Authentication** → Email/Password
   - **Firestore Database** → crear base de datos

### 2. Crear tu usuario
En Firebase Console → Authentication → Users → Add user

### 3. Reglas de Firestore
En Firestore → Reglas, pega esto:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Deploy en GitHub Pages (como la app de basketball)

1. Sube los archivos a GitHub
2. Repositorio → Settings → Pages → Branch: main → /root
3. En unos minutos tendrás la URL pública
4. Cada vez que hagas cambios: `git add . && git commit -m "cambios" && git push`

## Instalar como app en iPhone/iPad
1. Abre la URL en Safari
2. Compartir → Añadir a pantalla de inicio

## Colecciones Firestore

- `clients` — clientes (name, phone, email, paymentType, bonoSize, sessionsLeft, active, notes)
- `slots`   — sesiones del calendario (type, clientId, date, duration, status, notes)
- `payments` — pagos registrados (clientId, amount, date, concept, sessions, notes)
