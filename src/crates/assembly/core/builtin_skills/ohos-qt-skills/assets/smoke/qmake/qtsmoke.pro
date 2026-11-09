# Environment smoke app, qmake route (env_smoke.py): the same configure -> make ->
# deploy_qt_libs.py -> devecocli_build.py -> hap_check.py -> device_run.py chain a
# qmake application takes later. main.cpp is the shared smoke source (../main.cpp,
# copied next to this file by env_smoke.py). Not an application.
TEMPLATE = app
TARGET = qtsmoke
QT += core gui widgets
SOURCES += main.cpp

ohos {
    # ohos_deployment.prf turns TEMPLATE = app into lib$${TARGET}.so only with a target.path (KI-007).
    target.path = $$OUT_PWD
    INSTALLS += target
}
