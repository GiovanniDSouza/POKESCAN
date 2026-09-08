CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pokemon_id` integer,
	`name` text NOT NULL,
	`set_name` text,
	`set_code` text,
	`card_number` text,
	`rarity` text,
	`language` text,
	`image` text,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `pokedex` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pokemon_id` integer NOT NULL,
	`registered_at` text,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokedex_pokemon_unique` ON `pokedex` (`pokemon_id`);--> statement-breakpoint
CREATE TABLE `prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`currency` text NOT NULL,
	`market_price` real NOT NULL,
	`source` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pokemon` ADD `generation` integer;--> statement-breakpoint
ALTER TABLE `pokemon` DROP COLUMN `registered`;