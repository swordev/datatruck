#!/bin/sh
if [ "$1" == "" ]; then
    datatruck-restic -h
elif 
    [ "$1" == "start-cron" ] || [ "$1" == "start" ] ||
    [ "$1" == "create" ] ||
    [ "$1" == "run" ] ||
    [ "$1" == "exec" ] || [ "$1" == "e" ] ||
    [ "$1" == "init" ] || [ "$1" == "i" ] ||
    [ "$1" == "backup" ] || [ "$1" == "b" ] ||
    [ "$1" == "copy" ] || [ "$1" == "c" ] ||
    [ "$1" == "prune" ] || [ "$1" == "p" ] ||
    [ "$1" == "help" ] ||
    [ ${1::1} == "-" ];
then
    datatruck-restic "$@"
else
    exec "$@"
fi