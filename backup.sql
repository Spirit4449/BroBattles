/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.11-MariaDB, for debian-linux-gnu (aarch64)
--
-- Host: localhost    Database: game
-- ------------------------------------------------------
-- Server version	10.11.11-MariaDB-0+deb12u1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
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
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_participants` (
  `match_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `party_id` int(11) DEFAULT NULL,
  `team` enum('team1','team2') NOT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`match_id`,`user_id`),
  KEY `fk_mp_user` (`user_id`),
  KEY `fk_mp_party` (`party_id`),
  CONSTRAINT `fk_mp_match` FOREIGN KEY (`match_id`) REFERENCES `matches` (`match_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `match_participants`
--

LOCK TABLES `match_participants` WRITE;
/*!40000 ALTER TABLE `match_participants` DISABLE KEYS */;
INSERT INTO `match_participants` VALUES
(12,41,NULL,'team2','ninja'),
(13,74,NULL,'team1','ninja'),
(13,75,NULL,'team2','ninja'),
(14,74,NULL,'team2','ninja'),
(14,75,NULL,'team1','ninja'),
(15,73,NULL,'team1','ninja'),
(15,74,NULL,'team2','thorg'),
(15,75,NULL,'team1','thorg'),
(16,73,NULL,'team2','ninja'),
(16,74,NULL,'team1','ninja'),
(16,75,NULL,'team1','thorg'),
(17,73,NULL,'team2','ninja'),
(17,74,NULL,'team1','ninja'),
(17,75,NULL,'team2','thorg'),
(18,73,NULL,'team1','thorg'),
(18,74,NULL,'team1','ninja'),
(18,75,NULL,'team2','thorg'),
(19,73,NULL,'team2','thorg'),
(19,74,NULL,'team2','ninja'),
(19,75,NULL,'team1','ninja'),
(20,73,NULL,'team2','thorg'),
(20,74,NULL,'team1','ninja'),
(20,75,NULL,'team1','ninja'),
(21,75,NULL,'team1','ninja'),
(22,75,NULL,'team1','ninja');
/*!40000 ALTER TABLE `match_participants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `match_tickets`
--

DROP TABLE IF EXISTS `match_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_tickets` (
  `ticket_id` int(11) NOT NULL AUTO_INCREMENT,
  `party_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `mode` int(11) NOT NULL,
  `map` int(11) NOT NULL,
  `size` tinyint(4) NOT NULL,
  `mmr` int(11) NOT NULL,
  `team1_count` tinyint(4) NOT NULL DEFAULT 0,
  `team2_count` tinyint(4) NOT NULL DEFAULT 0,
  `status` enum('queued','cancelled') NOT NULL DEFAULT 'queued',
  `claimed_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`ticket_id`),
  UNIQUE KEY `party_id` (`party_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_mt_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=102 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `matches` (
  `match_id` int(11) NOT NULL AUTO_INCREMENT,
  `mode` int(11) NOT NULL,
  `map` int(11) NOT NULL,
  `status` enum('queued','live','completed','cancelled') NOT NULL DEFAULT 'queued',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`match_id`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `matches`
--

LOCK TABLES `matches` WRITE;
/*!40000 ALTER TABLE `matches` DISABLE KEYS */;
INSERT INTO `matches` VALUES
(1,1,1,'completed','2025-12-18 15:52:01'),
(2,1,1,'completed','2025-12-18 15:55:42'),
(3,1,1,'completed','2025-12-18 15:56:12'),
(4,1,1,'completed','2025-12-18 15:58:13'),
(5,1,1,'completed','2025-12-18 16:00:40'),
(6,1,1,'completed','2025-12-18 16:04:13'),
(7,1,1,'completed','2025-12-18 16:05:14'),
(8,1,1,'completed','2025-12-18 16:17:08'),
(9,1,1,'completed','2025-12-18 16:20:15'),
(10,1,1,'completed','2025-12-18 19:29:22'),
(11,1,1,'completed','2025-12-18 19:30:06'),
(12,1,1,'completed','2026-01-23 03:44:32'),
(13,1,1,'completed','2026-02-22 01:57:12'),
(14,1,1,'completed','2026-02-22 01:58:00'),
(15,2,1,'completed','2026-02-22 02:00:58'),
(16,2,1,'completed','2026-02-22 02:02:14'),
(17,2,1,'completed','2026-02-22 02:02:48'),
(18,2,2,'completed','2026-02-22 02:03:28'),
(19,2,1,'completed','2026-02-22 02:04:44'),
(20,2,1,'completed','2026-02-22 02:05:10'),
(21,1,1,'completed','2026-02-22 02:06:30'),
(22,1,1,'completed','2026-02-22 02:07:02'),
(23,1,1,'completed','2026-03-04 03:45:38'),
(24,1,1,'completed','2026-03-04 03:46:06'),
(25,1,1,'completed','2026-03-04 03:46:29'),
(26,1,1,'completed','2026-03-04 03:46:52'),
(27,1,1,'completed','2026-03-04 03:47:14'),
(28,1,2,'completed','2026-03-04 03:48:21');
/*!40000 ALTER TABLE `matches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `parties`
--

DROP TABLE IF EXISTS `parties`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `parties` (
  `party_id` int(11) NOT NULL AUTO_INCREMENT,
  `status` enum('idle','queued','ready_check','live') NOT NULL DEFAULT 'idle',
  `mode` int(11) DEFAULT NULL,
  `map` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`party_id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `party_members` (
  `party_id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `team` enum('team1','team2') NOT NULL,
  `joined_at` timestamp NULL DEFAULT current_timestamp(),
  `last_seen` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`party_id`,`name`),
  KEY `fk_pm_user_name` (`name`),
  CONSTRAINT `fk_pm_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pm_user_name` FOREIGN KEY (`name`) REFERENCES `users` (`name`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `socket_id` varchar(100) DEFAULT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `char_levels` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`char_levels`)),
  `coins` int(11) DEFAULT 0,
  `gems` int(11) DEFAULT 0,
  `trophies` int(11) DEFAULT NULL,
  `password` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(41,'nischaydas51',NULL,'ninja','offline',NULL,'{\"ninja\":1,\"thorg\":1,\"draven\":0,\"wizard\":0}',161,15,NULL,'$2b$12$YiNIxqoTMfWlJZ9N.YaE/OV2xFWoV.T4hBE6YQts3jMBUU9UgIe3O','2026-01-21 18:42:46','2026-01-30 11:31:09'),
(73,'Nischay',NULL,'thorg','offline',NULL,'{\"ninja\": 1, \"thorg\": 2, \"draven\": 0, \"wizard\": 0}',502,55,NULL,'$2b$12$LRj16/KrifcuiNYglUiPB.wPpApIw.s1BQlecJcasCcufpHDriUuC','2026-02-21 20:56:27','2026-02-21 21:06:36'),
(74,'shared',NULL,'ninja','offline',NULL,'{\"ninja\": 1, \"thorg\": 2, \"draven\": 0, \"wizard\": 0}',1003,110,NULL,'$2b$12$SferccGYKp5IWCEjKKlXaO6nsWbZhpdcnIoR62J9BcDxYkSoJU0Fu','2026-02-21 20:56:30','2026-02-22 00:11:47'),
(75,'Pritis',NULL,'ninja','offline',NULL,'{\"ninja\": 3, \"thorg\": 3, \"draven\": 0, \"wizard\": 0}',143,85,NULL,'$2b$12$2T8xSJh4Sdmhzjx6oGa2Z.I.vaBsIZHjwoiNfy3qWLFUzwSHoQvSu','2026-02-21 20:56:40','2026-02-21 21:41:14'),
(79,'nishay',NULL,'thorg','offline',NULL,'{\"ninja\":1,\"thorg\":1,\"draven\":0,\"wizard\":0}',0,400,0,'$2b$12$Vl/GeVPn3kXGCFerDZvLleG0pDBZp/uTS1w52WjYQk9jP.v/RvFfK','2026-02-21 21:06:39','2026-02-23 14:36:43');
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

-- Dump completed on 2026-03-04 14:53:35
