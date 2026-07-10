# Meshtastic to Graphana

J'ai créé ce projet afin de localiser mon chien en temps réel sur une carte, mais également pour repérer les points de sortie de mon terrain grâce à un historique des positions.

Pour cela, j'ai choisi d'utiliser **Meshtastic**, une solution peu onéreuse et surtout ne nécessitant aucun abonnement.

Le système repose sur un tracker **SenseCAP Card Tracker T1000-E** et une station de base composée d'un **XIAO ESP32S3** associé à un module **LoRa Wio-SX1262**, connecté à mon réseau Wi-Fi.

Le tracker envoie les coordonnées GPS sur un canal privé via le réseau Meshtastic. La station de base reçoit ces informations, puis les publie via **MQTT** sur un broker **Mosquitto**. Un script récupère ensuite les messages MQTT et les enregistre dans une base de données.

Pour l'interface graphique, j'utilise **Grafana**. Bien que cette solution ne puisse pas rivaliser avec une interface développée sur mesure, elle répond parfaitement à mes besoins tout en m'évitant de développer une application dédiée.

Concernant l'hébergement, je dispose à mon domicile d'un mini-PC **Dell OptiPlex** sur lequel sont hébergés **Grafana**, la base de données, le broker **Mosquitto**, ainsi que le script chargé de lire les messages MQTT et de les enregistrer dans la base de données.


## 📐 Architecture

```text
🐶 SenseCAP Card Tracker T1000-E
            │
            ▼
      🛜 Réseau Meshtastic
            │
            ▼
📡 Station de base Meshtastic (XIAO ESP32S3 + Wio-SX1262)
            │
      🛜 Wi-Fi
            │
            ▼
🖥️ Serveur
      ├── Mosquitto (MQTT)
      ├── Script MQTT -> BDD
      ├── Base de données
      └── Grafana
            │
         🛜 HTTP(S)
            │
            ▼
🌍 Client Web
```

![Architecture](img/architecture.png)

---
## 🛠️ Matériel utilisé

| Matériel | Lien | Prix indicatif |
|----------|------|---------------:|
| SenseCAP Card Tracker T1000-E | [Seeed Studio](https://www.seeedstudio.com/SenseCAP-Card-Tracker-T1000-E-for-Meshtastic-p-5913.html) | ~40 € |
| Kit XIAO ESP32S3 + Wio-SX1262 | [Seeed Studio](https://www.seeedstudio.com/Wio-SX1262-with-XIAO-ESP32S3-p-5982.html) | ~10 € |
| Grove Base for XIAO | [Seeed Studio](https://www.seeedstudio.com/Grove-Shield-for-Seeeduino-XIAO-p-4621.html) | ~4 € |
| Batterie | LiPo 3,7 V ou Li-ion 18650 |  |

![Hardware](img/hardware.png)

---

## 📡 Configuration de la station

![Station Configuration](img/station_config.png)

---

## 🐶 Configuration du tracker

![Tracker Configuration](img/tracker_config.png)


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

![Graphane example](img/graphana_1.png)

---
