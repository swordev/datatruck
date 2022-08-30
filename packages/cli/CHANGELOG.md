# @datatruck/cli

## 0.13.1

### Patch Changes

- [`bfd61c7`](https://github.com/swordev/datatruck/commit/bfd61c7c5cdec7aea4f66193094786797231b1d6) Thanks [@juanrgm](https://github.com/juanrgm)! - Enhance 7zip performance

* [`a208200`](https://github.com/swordev/datatruck/commit/a20820044fe8dac007bbc70de840b27735c689ef) Thanks [@juanrgm](https://github.com/juanrgm)! - Skip not found file errors during backups

- [`442bd3d`](https://github.com/swordev/datatruck/commit/442bd3d7376e6c546cfcba69a80048e90e11a488) Thanks [@juanrgm](https://github.com/juanrgm)! - Deny additional properties in SQL dump task config

## 0.13.0

### Minor Changes

- [`64cbb10`](https://github.com/swordev/datatruck/commit/64cbb10ea2526612e9f1183c878f146dbe4cea13) Thanks [@juanrgm](https://github.com/juanrgm)! - Save and show snapshot size

* [`297d120`](https://github.com/swordev/datatruck/commit/297d1202c49a3a6b4a5eafc3871359c1af637d52) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `progress` and `progress-interval` global options

- [`cb0ea35`](https://github.com/swordev/datatruck/commit/cb0ea35161ce8f67c40c6c77d1169d648ac0dfcd) Thanks [@juanrgm](https://github.com/juanrgm)! - Show restic restore progress

* [`357b995`](https://github.com/swordev/datatruck/commit/357b995c041f3167290a5ce9ae4f9a8d122f2a10) Thanks [@juanrgm](https://github.com/juanrgm)! - Rename local repository to datatruck

### Patch Changes

- [`aca9634`](https://github.com/swordev/datatruck/commit/aca9634313d562065a3e09efde8adf31b9939f89) Thanks [@juanrgm](https://github.com/juanrgm)! - Use local cache in the restic repositories

* [`25f0cbb`](https://github.com/swordev/datatruck/commit/25f0cbb2754ca1b082a51e929c373f88825bc18d) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix undefined progress of restic

## 0.12.1

### Patch Changes

- [`23bab2a`](https://github.com/swordev/datatruck/commit/23bab2ad73801398c799759cc275be2b17350545) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix package config option

## 0.12.0

### Minor Changes

- [`0effb38`](https://github.com/swordev/datatruck/commit/0effb38d1cc0b50ba43cd2948c7ff98d2b17325d) Thanks [@juanrgm](https://github.com/juanrgm)! - Add package config filter

### Patch Changes

- [`31446fb`](https://github.com/swordev/datatruck/commit/31446fb69273ac1619cdf2f8965f8b702da5882f) Thanks [@juanrgm](https://github.com/juanrgm)! - Throw controlled error when package config not found

## 0.11.7

### Patch Changes

- [`303dbf6`](https://github.com/swordev/datatruck/commit/303dbf63127c2bafd8a24c5733fa8b33d311f3ff) Thanks [@juanrgm](https://github.com/juanrgm)! - Allow non file password in restic repository url

## 0.11.6

### Patch Changes

- [`3a3c54d`](https://github.com/swordev/datatruck/commit/3a3c54db7075882604a3fc0fd8827271ab04ba29) Thanks [@juanrgm](https://github.com/juanrgm)! - Exlude files in restic repository

## 0.11.5

### Patch Changes

- [`cee6fee`](https://github.com/swordev/datatruck/commit/cee6fee924a8ae637a8f3bfece03890d6ad34ddf) Thanks [@juanrgm](https://github.com/juanrgm)! - Avoid scan all excluded files

## 0.11.4

### Patch Changes

- [`6328aec`](https://github.com/swordev/datatruck/commit/6328aece04027d76d2092bd916671d49c91cdc6d) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix task name filter

## 0.11.3

### Patch Changes

- [`6aeac04`](https://github.com/swordev/datatruck/commit/6aeac04803c18a3f91d87f215857b250e1e7defd) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix `packageTaskNames` filter

## 0.11.2

### Patch Changes

- [`9432df5`](https://github.com/swordev/datatruck/commit/9432df56f6c6444a59d98e79cf4b7db9f4d35854) Thanks [@juanrgm](https://github.com/juanrgm)! - Show zip progress

* [`c16daa2`](https://github.com/swordev/datatruck/commit/c16daa22d922bd610a161f37911fdb6f52666d38) Thanks [@juanrgm](https://github.com/juanrgm)! - Sort table names in the SQL dump tasks

## 0.11.1

### Patch Changes

- [`c65035c`](https://github.com/swordev/datatruck/commit/c65035cb6e9b8f5082f7b6d2ad59078ea1bd6abb) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix WSL system patch

## 0.11.0

### Minor Changes

- [`8aa3c1a`](https://github.com/swordev/datatruck/commit/8aa3c1a1334870cc11b610b3b0a9bf10b0a97126) Thanks [@juanrgm](https://github.com/juanrgm)! - Add predefined output templates

### Patch Changes

- [`763a724`](https://github.com/swordev/datatruck/commit/763a72473505232884e1b3871f2f4d1c55bb74d6) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix file copy in WSL system

## 0.10.0

### Minor Changes

- [`bc9a0dd`](https://github.com/swordev/datatruck/commit/bc9a0ddf2bfb9353545c28d9cbd12e592328024e) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `mirrorRepoNames` config option

### Patch Changes

- [`795936c`](https://github.com/swordev/datatruck/commit/795936c1d2add7819ff5f40679313e1e594aeb7e) Thanks [@juanrgm](https://github.com/juanrgm)! - Show error stack trace if directory does not exist

* [`d0d77b6`](https://github.com/swordev/datatruck/commit/d0d77b6c3d4eb0461c176981b165e20b49826082) Thanks [@juanrgm](https://github.com/juanrgm)! - Update dependencies

## 0.9.0

### Minor Changes

- [`05de947`](https://github.com/swordev/datatruck/commit/05de947264727cddb79293eca6cb0b43382eab6b) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `storedPrograms` config option in `mysql-dump` task

### Patch Changes

- [`ef99bdf`](https://github.com/swordev/datatruck/commit/ef99bdf0301b5bbdf965c1fa1d00e78edce1c931) Thanks [@juanrgm](https://github.com/juanrgm)! - Update dependencies

## 0.8.0

### Minor Changes

- [`8c421ab`](https://github.com/swordev/datatruck/commit/8c421ab0adb6f2d5bc81e91fa387c5daa848f411) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `--package-task` option to snapshot command

## 0.7.0

### Minor Changes

- [`3b8d6da`](https://github.com/swordev/datatruck/commit/3b8d6da01495799aceb848a63b35b8c46a7d1b0e) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `--package-task` cli option

* [`69b34a0`](https://github.com/swordev/datatruck/commit/69b34a02b9cade48df2b071a92a8f79d5cfec23e) Thanks [@juanrgm](https://github.com/juanrgm)! - Allow restore multiple backups over the same database

- [`69caf26`](https://github.com/swordev/datatruck/commit/69caf26881272331bd4c8d7d345b3b85d33e33ac) Thanks [@juanrgm](https://github.com/juanrgm)! - Add cli short option to `--tag`

* [`377f0de`](https://github.com/swordev/datatruck/commit/377f0de345c9c8f45c772ac47e4ded81e91725d7) Thanks [@juanrgm](https://github.com/juanrgm)! - Rename cli short option to `-rt`

### Patch Changes

- [`c03200a`](https://github.com/swordev/datatruck/commit/c03200a6347d1e9f9fdad86dcb22df30bbefcab4) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix `sql-dump` tasks

* [`f56a4bc`](https://github.com/swordev/datatruck/commit/f56a4bcb429a674c13f32de73985cd67eb1acc23) Thanks [@juanrgm](https://github.com/juanrgm)! - Show full error message

- [`4324422`](https://github.com/swordev/datatruck/commit/4324422550474619811a8d455af55bc6e3b08aeb) Thanks [@juanrgm](https://github.com/juanrgm)! - Use connection port in `mysql-dump` task

## 0.6.1

### Patch Changes

- [`0ba6229`](https://github.com/swordev/datatruck/commit/0ba6229348c109a59783e72242ab7c0e61f25e36) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix progress bar in restic repository

## 0.6.0

### Minor Changes

- [`0c6877d`](https://github.com/swordev/datatruck/commit/0c6877d189761e75dd434b0a8d72b71621d024de) Thanks [@juanrgm](https://github.com/juanrgm)! - Show more progress stats

* [`751e1f6`](https://github.com/swordev/datatruck/commit/751e1f6d6b33d3fa96eb40d998fdd140ce0e3875) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `fileCopyConcurrency` option

- [`05487e6`](https://github.com/swordev/datatruck/commit/05487e6a33f875a3afb7ff0815b16da6f2a41301) Thanks [@juanrgm](https://github.com/juanrgm)! - Parse InnoDB error in `MariadbTask` to avoid infinite wait

### Patch Changes

- [`b62a6f8`](https://github.com/swordev/datatruck/commit/b62a6f8a82409339afd65d4f96476eb57bbfb5a2) Thanks [@juanrgm](https://github.com/juanrgm)! - Resolve target/restore path in local repository

## 0.5.0

### Minor Changes

- [`5aeb2af`](https://github.com/swordev/datatruck/commit/5aeb2afb96692e00bdba501b58df9cc0e02dceaa) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `enabled` option to repository config

* [`75de836`](https://github.com/swordev/datatruck/commit/75de8369356cf02ed3fd5c58b1f9bea66432cda8) Thanks [@juanrgm](https://github.com/juanrgm)! - Allow restic password without file

## 0.4.0

### Minor Changes

- [`eeb00a6`](https://github.com/swordev/datatruck/commit/eeb00a69d75c91da40711ae79475612b1d5193b6) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `tempDir` config option

## 0.3.2

### Patch Changes

- [`8957c3b`](https://github.com/swordev/datatruck/commit/8957c3b5846606db8b825fef357445210f2a3ac3) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix restic progress parser

* [`2989718`](https://github.com/swordev/datatruck/commit/29897185e3d6659359d51ab2212351005137f86c) Thanks [@juanrgm](https://github.com/juanrgm)! - Show closing reason

- [`b9e0843`](https://github.com/swordev/datatruck/commit/b9e0843c7970944cfd30a7d2a543f515adfa60e4) Thanks [@juanrgm](https://github.com/juanrgm)! - Show restic progress in megabytes

## 0.3.1

### Patch Changes

- [`c3bb4c6`](https://github.com/swordev/datatruck/commit/c3bb4c609887c5525cf35487ea237750addb6e75) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix restic stdout parser

## 0.3.0

### Minor Changes

- [`d63fd25`](https://github.com/swordev/datatruck/commit/d63fd25ffa8d2e539d2125dfd6a3f55020086804) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `snapshotDate` param

* [`486ef4a`](https://github.com/swordev/datatruck/commit/486ef4add27ae1dbfd166b16c257522f43537ecd) Thanks [@juanrgm](https://github.com/juanrgm)! - Resolve params in `include` and `exclude`

- [`617dae2`](https://github.com/swordev/datatruck/commit/617dae2c8ed90e6e65e8109f03cfad0e64bd7c02) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `script` task

### Patch Changes

- [`d1b3ea9`](https://github.com/swordev/datatruck/commit/d1b3ea9c9540d30898c00490963523a4fbc68193) Thanks [@juanrgm](https://github.com/juanrgm)! - Avoid use gitignore if is not necessary in restic repository

## 0.2.0

### Minor Changes

- [`120460c`](https://github.com/swordev/datatruck/commit/120460c8824cef4184e43f571a4cc0798b899b66) Thanks [@juanrgm](https://github.com/juanrgm)! - Enable `include` option in restic repository

### Patch Changes

- [`e30ede3`](https://github.com/swordev/datatruck/commit/e30ede371bc7ab3fc1cd47758fdac7a28e8e2705) Thanks [@juanrgm](https://github.com/juanrgm)! - Resolve `RESTIC_PASSWORD_FILE` path

* [`8539d28`](https://github.com/swordev/datatruck/commit/8539d285b2c51d700aa811cd772d573fa0d613eb) Thanks [@juanrgm](https://github.com/juanrgm)! - Allow empty backup in restic repository

## 0.1.0

### Minor Changes

- [`88d46cd`](https://github.com/swordev/datatruck/commit/88d46cd56293df4c6fc21a9ad61d6236ac91f325) Thanks [@juanrgm](https://github.com/juanrgm)! - Add `custom` output format

### Patch Changes

- [`24a1e5e`](https://github.com/swordev/datatruck/commit/24a1e5e86336e7a92556287e49548dc542f0e579) Thanks [@juanrgm](https://github.com/juanrgm)! - Update dependencies

## 0.0.6

### Patch Changes

- [`8de6e6c`](https://github.com/swordev/datatruck/commit/8de6e6ceddb59635cb4634d884e7690eeaf59bac) Thanks [@juanrgm](https://github.com/juanrgm)! - Publish migrations

## 0.0.5

### Patch Changes

- [`78cb0c1`](https://github.com/swordev/datatruck/commit/78cb0c17558543841cd7080dc4c672e6cbfd5634) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix docker image

## 0.0.4

### Patch Changes

- [`d9e534b`](https://github.com/swordev/datatruck/commit/d9e534bd968acf9cd1c93f20e6152c004cb1f23b) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix package file read

* [`b882c58`](https://github.com/swordev/datatruck/commit/b882c58183e9a75abc876645e18d7b67186dd662) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix read of migrations

## 0.0.3

### Patch Changes

- [`051a7da`](https://github.com/swordev/datatruck/commit/051a7da225fcfea1c30a4fbfa8aea1b8f5538367) Thanks [@juanrgm](https://github.com/juanrgm)! - Fix dist files

## 0.0.2

### Patch Changes

- [`0911351`](https://github.com/swordev/datatruck/commit/09113517e1a77f2d2a1e19e4c3d9af7da1e28415) Thanks [@juanrgm](https://github.com/juanrgm)! - Publish docker image
