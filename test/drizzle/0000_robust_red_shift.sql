CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text(256),
	`published` integer,
	`post_id` text,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text,
	`title` text,
	`owner_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text NOT NULL
);
