-- Script d'initialisation de la base de données
-- Ce fichier sera exécuté automatiquement au démarrage du conteneur MySQL

CREATE DATABASE IF NOT EXISTS wallpaper_guessr;
USE wallpaper_guessr;

-- Les tables seront créées automatiquement par TypeORM avec synchronize: true
-- Ce fichier sert principalement à s'assurer que la base de données existe

-- Optionnel: Créer des index pour améliorer les performances
-- Ces commandes seront exécutées après la création automatique des tables par TypeORM

-- Index pour les recherches de wallpapers
-- ALTER TABLE wallpaper ADD INDEX idx_title (title);
-- ALTER TABLE wallpaper ADD INDEX idx_country_code (country(50));

-- Index pour les utilisateurs
-- ALTER TABLE user ADD INDEX idx_email (email);

-- Index pour les parties et jeux
-- ALTER TABLE party ADD INDEX idx_creator_id (creatorId);
-- ALTER TABLE game ADD INDEX idx_user_id (userId);

FLUSH PRIVILEGES;