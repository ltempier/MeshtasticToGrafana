<div align="center">

# 🐶 Meshtastic to Grafana

**Suivi GPS temps réel et historique de position, sans abonnement, basé sur Meshtastic**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker Compose](https://img.shields.io/badge/deploy-docker--compose-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Meshtastic](https://img.shields.io/badge/Meshtastic-compatible-67EA94)](https://meshtastic.org)

[English version](README.en.md)

</div>

---

## 📖 À propos

J'ai créé ce projet pour localiser mon chien en temps réel sur une carte, et pour repérer les points de sortie de mon terrain grâce à un historique des positions.

Pour cela, j'ai choisi **Meshtastic**, une solution peu onéreuse et surtout ne nécessitant aucun abonnement.

Le système repose sur :
- un tracker **SenseCAP Card Tracker T1000-E** ;
- une station de base composée d'un **XIAO ESP32S3** associé à un module **LoRa Wio-SX1262**, connectée à mon réseau Wi-Fi.

Le tracker envoie ses coordonnées GPS sur un canal privé via le réseau Meshtastic. La station de base reçoit ces informations puis les publie via **MQTT** sur un broker **Mosquitto**. Un script Node.js récupère ensuite les messages MQTT et les enregistre dans une base **PostgreSQL**.

Pour l'interface graphique, j'utilise **Grafana**. Cette solution ne rivalise pas avec une application développée sur mesure, mais elle répond parfaitement au besoin tout en évitant de développer une interface dédiée.

Le tout est hébergé à domicile sur un mini-PC **Dell OptiPlex**, qui fait tourner Grafana, la base de données, le broker Mosquitto et le script MQTT → BDD.

---

## 📐 Architecture

```
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
      ├── Script MQTT → BDD
      ├── Base de données (PostgreSQL)
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

| Matériel                      | Lien                                                                                                  | Prix indicatif |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------- |
| SenseCAP Card Tracker T1000-E  | [Seeed Studio](https://www.seeedstudio.com/SenseCAP-Card-Tracker-T1000-E-for-Meshtastic-p-5913.html)  | ~40 €           |
| Kit XIAO ESP32S3 + Wio-SX1262  | [Seeed Studio](https://www.seeedstudio.com/Wio-SX1262-with-XIAO-ESP32S3-p-5982.html)                  | ~10 €           |
| Grove Base for XIAO            | [Seeed Studio](https://www.seeedstudio.com/Grove-Shield-for-Seeeduino-XIAO-p-4621.html)               | ~4 €            |
| Batterie                       | LiPo 3,7 V ou Li-ion 18650                                                                              | —               |

![Hardware](img/hardware.png)

---

## 🚀 Démarrage rapide

Prérequis : [Docker](https://docs.docker.com/get-docker/) et [Docker Compose](https://docs.docker.com/compose/install/).

```bash
git clone https://github.com/ltempier/MeshtasticToGrafana.git
cd MeshtasticToGrafana
cp ".env copy" .env    # renseigner les variables (voir ci-dessous)
docker compose up -d
```

Une fois les conteneurs démarrés :
- **Grafana** est accessible sur `http://<adresse-du-serveur>:3000`
- **Mosquitto (MQTT)** écoute sur le port `1883`
- **PostgreSQL** écoute sur le port `5432`

> ℹ️ Adapte les ports exposés dans `docker-compose.yml` selon ton installation.

### Variables d'environnement (`.env`)

| Variable                     | Description                              |
| ----------------------------- | ----------------------------------------- |
| `MQTT_USER`                  | Identifiant du broker MQTT                |
| `MQTT_PASS`                  | Mot de passe du broker MQTT               |
| `POSTGRES_USER`              | Utilisateur PostgreSQL                    |
| `POSTGRES_PASSWORD`          | Mot de passe PostgreSQL                   |
| `GF_SECURITY_ADMIN_PASSWORD` | Mot de passe administrateur Grafana       |

```env
MQTT_USER="..."
MQTT_PASS="..."

POSTGRES_USER="..."
POSTGRES_PASSWORD="..."

GF_SECURITY_ADMIN_PASSWORD="..."
```

---

## 📡 Configuration de la station de base

Configuration Meshtastic de la station (XIAO ESP32S3 + Wio-SX1262) : rôle, région radio, canal privé, connexion Wi-Fi et redirection MQTT vers le broker local.

![Station Configuration](img/station_config.png)

---

## 🐶 Configuration du tracker

Configuration du **SenseCAP Card Tracker T1000-E** : canal privé partagé avec la station de base, intervalle d'envoi de la position et mode d'économie d'énergie.

![Tracker Configuration](img/tracker_config.png)

---

## 🗄️ Base de données

Le script [`meshtastic.js`](node_scripts) crée automatiquement, au démarrage, la table `messages` si elle n'existe pas :

| Colonne                                  | Description                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                                     | Identifiant auto-incrémenté                                                     |
| `receive_time`                           | Horodatage de réception côté serveur                                            |
| `topic` / `topic_channel` / `topic_node` | Topic MQTT d'origine et ses composantes                                         |
| `msg_id`                                 | ID du paquet Meshtastic                                                         |
| `from_node` / `to_node`                  | Identifiants numériques des nœuds source/destination                            |
| `from_txt` / `to_txt`                    | Version hexadécimale courte (4 derniers caractères), générée automatiquement    |
| `type`                                   | Type de paquet (`position`, `nodeinfo`, `telemetry`, etc.)                      |
| `sender`                                 | Identifiant du nœud émetteur (`!xxxxxxxx`)                                      |
| `channel`                                | Canal Meshtastic                                                                 |
| `hop_start` / `hops_away`                | Informations de routage LoRa                                                     |
| `node_ts`                                | Horodatage fourni par le nœud lui-même                                          |
| `payload`                                | Corps JSON complet du message (JSONB)                                           |

Le topic MQTT suivi respecte le format Meshtastic standard :

```
msh/<region>/<canal>/json/<...>/<node>
# ex : msh/EU_868/2/json/ROM/!9e9d189c
```

---

## 📊 Visualisation Grafana

Une fois les données en base, crée un dashboard Grafana pointant sur la datasource PostgreSQL pour afficher la position en temps réel sur une carte, ainsi que l'historique des trajets.

![Graphana example](img/graphana_1.png)

### Requêtes SQL utilisées

**Activité (nombre de positions dans le temps)**

Cette requête compte le nombre de positions reçues, regroupées par intervalle de temps adaptatif (par minute, par tranche de 30 minutes ou par heure selon la plage sélectionnée dans Grafana). Elle sert à afficher un graphique d'activité du tracker (fréquence des remontées GPS) sur un panel de type "time series" ou "bar chart".

```sql
SELECT
  CASE
    WHEN $__unixEpochTo() - $__unixEpochFrom() > 24 * 3600 THEN
      date_trunc('hour', receive_time)

    WHEN $__unixEpochTo() - $__unixEpochFrom() > 3 * 3600 THEN
      date_trunc('hour', receive_time)
      + floor(extract(minute FROM receive_time) / 30) * interval '30 minutes'

    ELSE
      date_trunc('minute', receive_time)
  END AS time,
  COUNT(*) AS nb_positions
FROM messages
WHERE $__timeFilter(receive_time)
  AND type = 'position'
  AND from_txt = '49d3'
GROUP BY 1
ORDER BY 1;
```

**Positions GPS**

Cette requête extrait latitude, longitude et altitude des messages de type `position` sur la plage temporelle sélectionnée. Elle alimente un panel de type "Geomap" (ou "Trail") pour afficher la position en temps réel et l'historique des trajets sur la carte.

```sql
SELECT
  receive_time,
  EXTRACT(EPOCH FROM receive_time) AS ts_epoch,
  ((payload->>'latitude_i')::float / 10000000.0) AS latitude,
  ((payload->>'longitude_i')::float / 10000000.0) AS longitude,
  (payload->>'altitude')::float AS altitude
FROM messages
WHERE receive_time BETWEEN $__timeFrom() AND $__timeTo()
  AND type = 'position'
  AND from_txt = '49d3'
ORDER BY receive_time asc
LIMIT 1000000;
```

> ℹ️ `from_txt = '49d3'` filtre sur l'identifiant court du nœud émetteur (ici le tracker). Remplace cette valeur par les 4 derniers caractères de l'identifiant de ton propre appareil.

---

## 📄 Licence

Ce projet est distribué sous licence [MIT](LICENSE).