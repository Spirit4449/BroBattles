-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: game
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `match_participants`
--

DROP TABLE IF EXISTS `match_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_participants` (
  `match_id` int NOT NULL,
  `user_id` int NOT NULL,
  `party_id` int DEFAULT NULL,
  `team` enum('team1','team2') NOT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`match_id`,`user_id`),
  KEY `fk_mp_user` (`user_id`),
  KEY `fk_mp_party` (`party_id`),
  CONSTRAINT `fk_mp_match` FOREIGN KEY (`match_id`) REFERENCES `matches` (`match_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `match_participants`
--

LOCK TABLES `match_participants` WRITE;
/*!40000 ALTER TABLE `match_participants` DISABLE KEYS */;
INSERT INTO `match_participants` VALUES (1,1,NULL,'team1','ninja'),(1,2,NULL,'team2','ninja'),(5,1,NULL,'team1','wizard'),(5,2,NULL,'team2','ninja'),(9,2,NULL,'team2','thorg'),(9,3,NULL,'team1','ninja');
/*!40000 ALTER TABLE `match_participants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `match_tickets`
--

DROP TABLE IF EXISTS `match_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_tickets` (
  `ticket_id` int NOT NULL AUTO_INCREMENT,
  `party_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `mode` int NOT NULL,
  `map` int NOT NULL,
  `size` tinyint NOT NULL,
  `mmr` int NOT NULL,
  `team1_count` tinyint NOT NULL DEFAULT '0',
  `team2_count` tinyint NOT NULL DEFAULT '0',
  `status` enum('queued','cancelled') NOT NULL DEFAULT 'queued',
  `claimed_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ticket_id`),
  UNIQUE KEY `party_id` (`party_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_mt_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `match_tickets`
--

LOCK TABLES `match_tickets` WRITE;
/*!40000 ALTER TABLE `match_tickets` DISABLE KEYS */;
/*!40000 ALTER TABLE `match_tickets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `matches`
--

DROP TABLE IF EXISTS `matches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `matches` (
  `match_id` int NOT NULL AUTO_INCREMENT,
  `mode` int NOT NULL,
  `map` int NOT NULL,
  `status` enum('queued','live','completed','cancelled') NOT NULL DEFAULT 'queued',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`match_id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `matches`
--

LOCK TABLES `matches` WRITE;
/*!40000 ALTER TABLE `matches` DISABLE KEYS */;
INSERT INTO `matches` VALUES (1,1,1,'completed','2025-12-18 15:52:01'),(2,1,1,'completed','2025-12-18 15:55:42'),(3,1,1,'completed','2025-12-18 15:56:12'),(4,1,1,'completed','2025-12-18 15:58:13'),(5,1,1,'completed','2025-12-18 16:00:40'),(6,1,1,'completed','2025-12-18 16:04:13'),(7,1,1,'completed','2025-12-18 16:05:14'),(8,1,1,'completed','2025-12-18 16:17:08'),(9,1,1,'live','2025-12-18 16:20:15');
/*!40000 ALTER TABLE `matches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `parties`
--

DROP TABLE IF EXISTS `parties`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parties` (
  `party_id` int NOT NULL AUTO_INCREMENT,
  `status` enum('idle','queued','ready_check','live') NOT NULL DEFAULT 'idle',
  `mode` int DEFAULT NULL,
  `map` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`party_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parties`
--

LOCK TABLES `parties` WRITE;
/*!40000 ALTER TABLE `parties` DISABLE KEYS */;
/*!40000 ALTER TABLE `parties` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `party_members`
--

DROP TABLE IF EXISTS `party_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `party_members` (
  `party_id` int NOT NULL,
  `name` varchar(50) NOT NULL,
  `team` enum('team1','team2') NOT NULL,
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`party_id`,`name`),
  KEY `fk_pm_user_name` (`name`),
  CONSTRAINT `fk_pm_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pm_user_name` FOREIGN KEY (`name`) REFERENCES `users` (`name`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `party_members`
--

LOCK TABLES `party_members` WRITE;
/*!40000 ALTER TABLE `party_members` DISABLE KEYS */;
/*!40000 ALTER TABLE `party_members` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `socket_id` varchar(100) DEFAULT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `char_levels` json DEFAULT NULL,
  `coins` int DEFAULT '0',
  `gems` int DEFAULT '0',
  `trophies` int DEFAULT NULL,
  `password` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Guest865448',NULL,'wizard','offline','2025-12-18 12:51:46','{\"ninja\": 1, \"thorg\": 1, \"draven\": 0, \"wizard\": 0}',216,20,0,NULL,'2025-12-18 10:51:46','2025-12-18 11:12:15'),(2,'Guest656074','o_gSIlejJpQMFNF9AAAD','thorg','offline','2025-12-18 12:52:00','{\"ninja\": 1, \"thorg\": 1, \"draven\": 0, \"wizard\": 0}',387,25,NULL,NULL,'2025-12-18 10:51:59','2025-12-18 11:23:33'),(3,'Guest219460','Ga9lR2epLsIveTGOAAAB','ninja','offline','2025-12-18 13:17:05','{\"ninja\": 1, \"thorg\": 1, \"draven\": 0, \"wizard\": 0}',0,0,NULL,NULL,'2025-12-18 11:17:05','2025-12-18 11:23:33');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-12-18 11:29:38
