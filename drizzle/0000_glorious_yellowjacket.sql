CREATE TABLE `pokemon` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`national_dex_number` integer NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`type1` text,
	`type2` text,
	`registered` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokemon_national_dex_number_unique` ON `pokemon` (`national_dex_number`);