--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE "backup_session" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"snapshotId"	TEXT NOT NULL,
	"packageName"	TEXT NOT NULL,
	-- "componentName"	TEXT NOT NULL,
	"tags"	TEXT
);

CREATE TABLE "backup_session_task" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"sessionId"	INTEGER NOT NULL,
	"taskName"	TEXT NOT NULL
);

CREATE TABLE "backup_session_repository" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"sessionId"	INTEGER NOT NULL,
	"repositoryName"	TEXT NOT NULL,
	"repositoryType"	TEXT NOT NULL
);

CREATE TABLE "restore_session" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"snapshotId"	TEXT NOT NULL,
	"packageName"	TEXT NOT NULL -- ,
	-- "componentName"	TEXT NOT NULL
);

CREATE TABLE "restore_session_task" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"sessionId"	INTEGER NOT NULL,
	"taskName"	TEXT NOT NULL
);

CREATE TABLE "restore_session_repository" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"creationDate"	TEXT NOT NULL,
	"updatingDate"	TEXT,

	"startDate"	TEXT,
	"endDate"	TEXT,
	"state"	TEXT,
	"error"	TEXT,
	"progress" TEXT,

	"sessionId"	INTEGER NOT NULL,
	"repositoryName"	TEXT NOT NULL,
	"repositoryType"	TEXT NOT NULL
);