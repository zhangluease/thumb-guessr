-- thumb-guessr initial MySQL schema
-- Safe to run repeatedly: database and tables are created only when absent.

CREATE DATABASE IF NOT EXISTS `thumb_guessr`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `thumb_guessr`;

CREATE TABLE IF NOT EXISTS `videos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `platform` VARCHAR(20) NOT NULL DEFAULT 'youtube',
  `platform_video_id` VARCHAR(64) NOT NULL,
  `channel_id` VARCHAR(64) NULL,
  `channel_title` VARCHAR(255) NULL,
  `title` VARCHAR(500) NOT NULL,
  `thumbnail_url` VARCHAR(2048) NOT NULL,
  `duration_seconds` INT UNSIGNED NULL,
  `published_at` DATETIME(3) NULL,
  `view_count` BIGINT UNSIGNED NOT NULL,
  `statistics_fetched_at` DATETIME(3) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_videos_platform_video` (`platform`, `platform_video_id`),
  KEY `idx_videos_quiz_pool` (`enabled`, `view_count`),
  KEY `idx_videos_published_at` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `video_stat_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `video_id` BIGINT UNSIGNED NOT NULL,
  `view_count` BIGINT UNSIGNED NOT NULL,
  `like_count` BIGINT UNSIGNED NULL,
  `comment_count` BIGINT UNSIGNED NULL,
  `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_video_snapshot_time` (`video_id`, `captured_at`),
  KEY `idx_video_snapshots_latest` (`video_id`, `captured_at` DESC),
  CONSTRAINT `fk_video_stat_snapshots_video`
    FOREIGN KEY (`video_id`) REFERENCES `videos` (`id`)
    ON DELETE CASCADE
    ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
