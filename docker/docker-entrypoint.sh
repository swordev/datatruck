#!/bin/sh
if 
    [ "$1" == "config" ] || [ "$1" == "c" ] || 
    [ "$1" == "init" ] || [ "$1" == "i" ] || 
    [ "$1" == "snapshots" ] || [ "$1" == "s" ] || 
    [ "$1" == "prune" ] || [ "$1" == "p" ] || 
    [ "$1" == "backup" ] || [ "$1" == "b" ] || 
    [ "$1" == "backup-sessions" ] || [ "$1" == "bs" ] || 
    [ "$1" == "restore" ] || [ "$1" == "r" ] || 
    [ "$1" == "restore-sessions" ] || [ "$1" == "rs" ] || 
    [ "$1" == "restore" ] || [ "$1" == "r" ] || 
    [ "$1" == "clean-cache" ] || [ "$1" == "cc" ] || 
    [ "$1" == "help" ] ||
    [ ${1::1} == "-" ]; 
then
    datatruck "$@"
else
    exec "$@"
fi