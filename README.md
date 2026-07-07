# Meshtastic to Graphana

J'ai créé ce projet afin de localiser mon chien en temps réel sur une carte, mais également pour repérer les points de sortie de mon terrain grâce à un historique des positions.

Pour cela, j'ai choisi d'utiliser **Meshtastic**, une solution peu onéreuse et surtout ne nécessitant aucun abonnement.

Le système repose sur un tracker **SenseCAP Card Tracker T1000-E** et une station de base composée d'un **XIAO ESP32S3** associé à un module **LoRa Wio-SX1262**, connecté à mon réseau Wi-Fi.

Le tracker envoie les coordonnées GPS sur un canal privé via le réseau Meshtastic. La station de base reçoit ces informations, puis les publie via **MQTT** sur un broker **Mosquitto**. Un script récupère ensuite les messages MQTT et les enregistre dans une base de données.

Pour l'interface graphique, j'utilise **Grafana**. Bien que cette solution ne puisse pas rivaliser avec une interface développée sur mesure, elle répond parfaitement à mes besoins tout en m'évitant de développer une application dédiée.

Concernant l'hébergement, je dispose à mon domicile d'un mini-PC **Dell OptiPlex** sur lequel sont hébergés **Grafana**, la base de données, le broker **Mosquitto**, ainsi que le script chargé de lire les messages MQTT et de les enregistrer dans la base de données.

---
## 📐 Architecture

```text
🐶 SenseCAP Card Tracker T1000-E
              │
              ▼
      Réseau LoRa Meshtastic
              │
              ▼
📡 Base Meshtastic (XIAO ESP32S3 + Wio-SX1262)
              │
            Wi-Fi
              │
              ▼
      Serveur:
      ├── Broker MQTT (Mosquitto)
      ├── Script de collecte MQTT
      ├── Base de données
      └── Grafana
```

---
## 🛠️ Matériel utilisé

| Matériel | Lien | Prix |
|----------|------|------:|
| SenseCAP Card Tracker T1000-E | https://www.seeedstudio.com/SenseCAP-Card-Tracker-T1000-E-for-Meshtastic-p-5913.html | ~40 € |
| Kit XIAO ESP32S3 + Wio-SX1262 | https://www.seeedstudio.com/Wio-SX1262-with-XIAO-ESP32S3-p-5982.html | ~10 € |

---

## 📡 Mise en place de la station de base

1. **Flash du firmware Meshtastic** sur la carte XIAO ESP32S3 via le flasher web officiel :
   
   👉 https://flasher.meshtastic.org/
   - Sélectionner le périphérique (USB)
   - Choisir le micrologiciel à flasher
   - Lancer le flash

2. **Configuration de la station** :

   👉 https://client.meshtastic.org/

   **Config → Wi-Fi**

   * `Enabled` : activé
   * `SSID` : nom de votre réseau Wi-Fi
   * `PSK` : mot de passe de votre réseau Wi-Fi

   **Radio Config → LoRa**

   * `Region` : `EU_868` (à adapter selon votre pays)
   * `Ignore MQTT` : désactivé
   * `OK to MQTT` : activé (autorise le transfert des paquets reçus vers le broker MQTT)

   **Module Config → MQTT**

   * `Enabled` : activé
   * `MQTT Server Address` : adresse IP ou nom d'hôte du broker Mosquitto
   * `MQTT Username` / `MQTT Password` : identifiants définis dans le fichier `.env`
   * `Encryption Enabled` : à activer selon vos besoins (sans chiffrement, les messages MQTT, y compris les positions GPS, transitent en clair)
   * `JSON Enabled` : activé (obligatoire, le script Node.js consomme les messages au format JSON)


---

## 🐶 Mise en place du tracker 

1. **Flash du firmware Meshtastic** sur la carte XIAO ESP32S3 via le flasher web officiel :
   
   👉 https://flasher.meshtastic.org/
   - Sélectionner le périphérique (USB)
   - Choisir le micrologiciel à flasher
   - Lancer le flash


2. **Configuration du tracker** :
   👉 https://client.meshtastic.org/

   **Radio Config → LoRa**
   - Region : `EU_868` (à adapter selon le pays)
   - `Ignore MQTT` : désactivé
   - `OK to MQTT` : activé (autorise le forward des paquets vers MQTT)

   **Module Config → MQTT**
   - `Enabled` : activé
   - `MQTT Server Address` : IP du serveur Mosquitto
   - `MQTT Username` / `MQTT Password` : identifiants définis dans `.env`
   - `Encryption Enabled` : selon besoin (attention : sans chiffrement, les messages transitent en clair, y compris les positions)
   - `JSON Enabled` : activé (obligatoire, le script Node consomme du JSON)

---


### Démarrage

```bash
git clone <ce dépôt>
cd <ce dépôt>
cp .env.example .env   # renseigner les variables (voir ci-dessous)
docker compose up -d
```

### Variables d'environnement (`.env`)

```env
MQTT_USER="..."
MQTT_PASS="..."

POSTGRES_USER="..."
POSTGRES_PASSWORD="..."

GF_SECURITY_ADMIN_PASSWORD="..."
```

⚠️ Ne jamais committer le fichier `.env` réel (uniquement un `.env.example` avec des valeurs factices).

---

## 🗄️ Base de données

Le script `meshtastic.js` crée automatiquement (au démarrage) la table `messages` si elle n'existe pas :

| Colonne | Description |
|---|---|
| `id` | Identifiant auto-incrémenté |
| `receive_time` | Horodatage de réception côté serveur |
| `topic` / `topic_channel` / `topic_node` | Topic MQTT d'origine et ses composantes |
| `msg_id` | ID du paquet Meshtastic |
| `from_node` / `to_node` | Identifiants numériques des nœuds source/destination |
| `from_txt` / `to_txt` | Version hexadécimale courte (4 derniers caractères) générée automatiquement |
| `type` | Type de paquet (`position`, `nodeinfo`, `telemetry`, etc.) |
| `sender` | Identifiant du nœud émetteur (`!xxxxxxxx`) |
| `channel` | Canal Meshtastic |
| `hop_start` / `hops_away` | Informations de routage LoRa |
| `node_ts` | Horodatage fourni par le nœud lui-même |
| `payload` | Corps JSON complet du message (JSONB) |

Le topic MQTT suivi a le format Meshtastic standard :
```
msh/<region>/<canal>/json/<...>/<node>
# ex : msh/EU_868/2/json/ROM/!9e9d189c
```

---

## 📊 Visualisation Grafana

Grafana est connecté à PostgreSQL et permet de construire des dashboards :

- **Carte de trajectoire** : tracé du parcours GPS à partir des positions successives.
- **Heatmap** : densité de présence sur une zone géographique.
- **Table des messages** : liste brute (heure de réception, canal, from/to, type, payload).
- **Graphique temporel** : fréquence des positions reçues dans le temps.

Accès : [http://localhost:3000](http://localhost:3000) (identifiants définis dans `.env`).

---

## 📁 Structure du dépôt

```
.
├── docker-compose.yml
├── mosquitto.conf
├── .env.example
└── node_scripts/
    ├── package.json
    └── meshtastic.js
```

---

## ✅ TODO / Améliorations possibles

- [ ] Déduplication plus robuste des messages (hash du payload)
- [ ] Alerting Grafana (ex. perte de signal / batterie faible)
- [ ] Chiffrement des communications MQTT (TLS)
- [ ] Provisioning automatique des dashboards Grafana (as code)