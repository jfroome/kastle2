#
# MIT License
#
# Copyright (c) 2026 Bastl Instruments
#

# App definition
create_kastle2_app(
    APP_NAME "beads"
    APP_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/AppBeads.cpp
                ${CMAKE_CURRENT_SOURCE_DIR}/BeadsDsp.cpp
)
