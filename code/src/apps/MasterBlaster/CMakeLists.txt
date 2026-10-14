#
# MIT License
# Copyright (c) 2026 Bastl Instruments
#

# App definition
create_kastle2_app(
    APP_NAME "master-blaster"
    APP_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/AppMasterBlaster.cpp
                ${CMAKE_CURRENT_SOURCE_DIR}/MasterBlasterDsp.cpp
)
