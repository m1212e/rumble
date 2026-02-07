CREATE TABLE `comments_table` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text,
	`published` integer,
	`someNumber` numeric DEFAULT 0,
	`postId` text,
	`ownerId` text NOT NULL,
	FOREIGN KEY (`postId`) REFERENCES `posts_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ownerId`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts_table` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`text` text,
	`ownerId` text,
	FOREIGN KEY (`ownerId`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users_table` (
	`id` text PRIMARY KEY NOT NULL,
	`firstName` text,
	`lastName` text,
	`email` text NOT NULL
);
